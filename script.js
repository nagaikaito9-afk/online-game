// --- Firebase初期設定 ---
const firebaseConfig = {
    apiKey: "AIzaSyDmP5Mhy9OINCQ3IiQAY9y9FuQh2OwRcRc",
    authDomain: "online-game-73f50.firebaseapp.com",
    databaseURL: "https://online-game-73f50-default-rtdb.firebaseio.com", 
    projectId: "online-game-73f50"
};
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();
const roomsRef = db.ref('match_rooms');

// --- サウンド管理 ---
let audioCtx = null;
let bgmVolume = parseFloat(localStorage.getItem('bgmVol') || "0.2");
let seVolume = parseFloat(localStorage.getItem('seVol') || "0.5");
let bgmInterval = null;

function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (!bgmInterval) {
        const notes = [261.6, 293.7, 329.6, 392.0, 440.0];
        bgmInterval = setInterval(() => {
            if (bgmVolume <= 0) return;
            const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.frequency.value = notes[Math.floor(Math.random() * notes.length)] / (Math.random() > 0.5 ? 2 : 1);
            gain.gain.setValueAtTime(bgmVolume * 0.1, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
            osc.start(); osc.stop(audioCtx.currentTime + 0.3);
        }, 600);
    }
}

function playSE(type) {
    if (!audioCtx || seVolume <= 0) return;
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    if (type === 'put') {
        osc.type = 'square'; osc.frequency.setValueAtTime(400, t); osc.frequency.exponentialRampToValueAtTime(600, t + 0.1);
        gain.gain.setValueAtTime(seVolume, t); gain.gain.linearRampToValueAtTime(0, t + 0.1);
        osc.start(t); osc.stop(t + 0.1);
    }
}
document.body.addEventListener('click', initAudio, { once: true });

// --- ランク・ユーザー管理 ---
const RANKS = ["ブロンズ I", "ブロンズ II", "ブロンズ III", "シルバー I", "シルバー II", "シルバー III", "ゴールド I", "ゴールド II", "ゴールド III", "プラチナ I", "プラチナ II", "プラチナ III", "ダイアモンド I", "ダイアモンド II", "ダイアモンド III", "マスター I", "マスター II", "マスター III", "マスター IV", "マスター V"];
let userData = JSON.parse(localStorage.getItem('boardGameUser')) || {
    id: Math.random().toString(36).substring(2, 10), name: "ゲスト" + Math.floor(Math.random() * 1000),
    points: { tictactoe: 0, othello: 0, chess: 0, go: 0 }
};
const myId = userData.id;

function getRank(pts) { return { name: RANKS[Math.min(Math.floor(pts / 100), 19)], index: Math.min(Math.floor(pts / 100), 19) }; }
function saveUser() { localStorage.setItem('boardGameUser', JSON.stringify(userData)); updateUI(); }
function updateUI() {
    document.getElementById('userNameDisplay').textContent = userData.name;
    ['tictactoe', 'othello', 'chess', 'go'].forEach(g => { 
        if(!document.getElementById(`rank-${g}`)) return;
        const pts = userData.points[g] || 0;
        document.getElementById(`rank-${g}`).textContent = `ランク: ${getRank(pts).name}`; 
        const progress = (pts >= 1900) ? 100 : (pts % 100);
        document.getElementById(`progress-${g}`).style.width = `${progress}%`;
    });
}
updateUI();

// --- 画面遷移・モーダル ---
function switchScreen(screenId) {
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
    document.getElementById('privateRoomError').textContent = ""; // エラーリセット
}

document.getElementById('settingsBtn').addEventListener('click', () => {
    document.getElementById('bgmVolumeSlider').value = bgmVolume; document.getElementById('seVolumeSlider').value = seVolume;
    document.getElementById('settingsModal').classList.remove('hidden');
});
document.getElementById('bgmVolumeSlider').addEventListener('input', (e) => { bgmVolume = parseFloat(e.target.value); localStorage.setItem('bgmVol', bgmVolume); });
document.getElementById('seVolumeSlider').addEventListener('input', (e) => { seVolume = parseFloat(e.target.value); localStorage.setItem('seVol', seVolume); });
document.getElementById('closeSettingsBtn').addEventListener('click', () => document.getElementById('settingsModal').classList.add('hidden'));
document.getElementById('openNameModalBtn').addEventListener('click', () => { document.getElementById('nameInput').value = userData.name; document.getElementById('nameModal').classList.remove('hidden'); });
document.getElementById('saveNameBtn').addEventListener('click', () => { const newName = document.getElementById('nameInput').value.trim(); if (newName) { userData.name = newName; saveUser(); } document.getElementById('nameModal').classList.add('hidden'); });
document.getElementById('cancelNameBtn').addEventListener('click', () => document.getElementById('nameModal').classList.add('hidden'));
document.querySelectorAll('.backToHomeBtn').forEach(btn => btn.addEventListener('click', () => switchScreen('homeScreen')));
document.getElementById('gameSelectBtn').addEventListener('click', () => switchScreen('gameSelectScreen'));
document.getElementById('backToGameSelectBtn').addEventListener('click', () => switchScreen('gameSelectScreen'));

// トランプ画面遷移
document.getElementById('trumpCategoryBtn').addEventListener('click', () => switchScreen('trumpSelectScreen'));

let selectedGame = null, currentMode = null, currentRoomId = null, myRole = null, gameListener = null, chatListener = null;
let chessEngine = null, chessSelectedSquare = null; 
const GAME_NAMES = { tictactoe: "〇✕ゲーム", othello: "オセロ", chess: "チェス", go: "囲碁", babanuki: "ババ抜き", speed: "スピード", sevens: "7ならべ", memory: "神経衰弱", daifugo: "大富豪" };

document.querySelectorAll('.btn-game').forEach(btn => {
    if(btn.id === 'trumpCategoryBtn') return; // カテゴリボタンは除外
    btn.addEventListener('click', (e) => {
        selectedGame = e.currentTarget.dataset.game;
        document.getElementById('selectedGameTitle').textContent = GAME_NAMES[selectedGame];
        document.getElementById('currentRankDisplay').textContent = userData.points[selectedGame] !== undefined ? `現在: ${getRank(userData.points[selectedGame] || 0).name}` : "トランプゲーム";
        
        // 囲碁専用設定の表示切替
        document.getElementById('goSettings').classList.toggle('hidden', selectedGame !== 'go');
        
        switchScreen('modeSelectScreen');
    });
});

// プライベートマッチ画面遷移
document.getElementById('privateRoomSelectBtn').addEventListener('click', () => switchScreen('privateRoomScreen'));

// --- ゲーム初期化と同期設定 ---
function getInitialBoard(type) {
    if (type === 'tictactoe') return Array(9).fill("");
    if (type === 'othello') { let b = Array(64).fill(""); b[27]="O"; b[28]="X"; b[35]="X"; b[36]="O"; return b; }
    if (type === 'chess') { chessEngine = new Chess(); chessSelectedSquare = null; return chessEngine.fen(); } 
    if (type === 'go') {
        const size = parseInt(document.getElementById('goSizeSelect').value);
        const handicap = parseInt(document.getElementById('goHandicap').value);
        let b = Array(size * size).fill("");
        
        if (handicap > 0) {
            // 置き石ロジック (簡易的な星の位置)
            const pts = getStarPoints(size);
            const handicapPts = {
                9: [2, 6, 4, 1, 5, 3, 7], // 2-7個
                13: [3, 9, 6, 2, 7, 4, 10, 5, 11], // 2-9個
                19: [3, 9, 6, 2, 7, 4, 10, 5, 11] // 2-9個
            };
            
            if(handicap >= 2) {
                // 簡易的に天元を最後に回し、星を優先
                const starIndexes = pts.filter((p, i) => size===9 ? i<4 : i<8);
                const tengenIndex = pts.filter((p, i) => size===9 ? i===4 : i===8)[0];
                let placed = 0;
                
                for(let i=0; i < Math.min(handicap, starIndexes.length); i++){
                    b[starIndexes[i].y * size + starIndexes[i].x] = "X";
                    placed++;
                }
                if(handicap > placed && tengenIndex) {
                    b[tengenIndex.y * size + tengenIndex.x] = "X";
                }
            } else if (handicap === 1) {
                const tengen = pts.filter((p, i) => size===9 ? i===4 : i===8)[0];
                if(tengen) b[tengen.y * size + tengen.x] = "X";
            }
        }
        return b;
    }
    return Array(9).fill(""); // default
}

// 盤面サイズに応じた星(と天元)の座標を取得
function getStarPoints(size) {
    if (size === 9) return [
        {x:2, y:2}, {x:6, y:2}, {x:2, y:6}, {x:6, y:6}, // 四隅の星
        {x:4, y:4} // 天元
    ];
    if (size === 13) return [
        {x:3, y:3}, {x:9, y:3}, {x:3, y:9}, {x:9, y:9}, // 四隅の星
        {x:3, y:6}, {x:9, y:6}, {x:6, y:3}, {x:6, y:9}, // 辺の星
        {x:6, y:6} // 天元
    ];
    if (size === 19) return [
        {x:3, y:3}, {x:15, y:3}, {x:3, y:15}, {x:15, y:15}, // 四隅の星
        {x:3, y:9}, {x:15, y:9}, {x:9, y:3}, {x:9, y:15}, // 辺の星
        {x:9, y:9} // 天元
    ];
    return [];
}

document.getElementById('modeLocalBtn').addEventListener('click', () => { currentMode = 'local'; myRole = 'local'; startLocalGame(); });
document.getElementById('modeAIBtn').addEventListener('click', () => { currentMode = 'ai'; myRole = 'w'; startLocalGame(); }); 

function startLocalGame() {
    switchScreen('gameScreen');
    document.getElementById('chatArea').classList.add('hidden');
    document.getElementById('matchTitle').textContent = currentMode === 'ai' ? "VS コンピュータ" : "近くの人と対戦";
    myRole = (selectedGame === 'chess' || selectedGame === 'go') && currentMode === 'ai' ? 'X' : myRole; 
    
    // 囲碁の置き石がある場合、最初の手番は白(O)
    let firstPlayer = "X";
    let handicap = 0;
    if (selectedGame === 'go') {
        handicap = parseInt(document.getElementById('goHandicap').value);
        if(handicap > 0) firstPlayer = "O";
    }

    let state = { 
        board: getInitialBoard(selectedGame), currentPlayer: firstPlayer, winner: null, isDraw: false,
        goSize: selectedGame === 'go' ? parseInt(document.getElementById('goSizeSelect').value) : null,
        handicap: handicap,
        captured: { X: 0, O: 0 } // アゲハマ用
    };
    renderBoard(state);
}

// オンライン(ランダムマッチ)
document.getElementById('modeOnlineBtn').addEventListener('click', () => {
    currentMode = 'online'; switchScreen('matchingScreen');
    document.getElementById('matchingText').textContent = "対戦相手を探しています";
    const myRank = getRank(userData.points[selectedGame]||0).index;
    
    let goSize = null, handicap = 0;
    if(selectedGame === 'go') {
        goSize = parseInt(document.getElementById('goSizeSelect').value);
        handicap = parseInt(document.getElementById('goHandicap').value);
    }

    roomsRef.orderByChild('status').equalTo('waiting').once('value', snapshot => {
        const rooms = snapshot.val(); let matchedId = null;
        if (rooms) { 
            for (let id in rooms) { 
                const r = rooms[id];
                if (!r.password && r.gameType === selectedGame && Math.abs(r.hostRankIndex - myRank) <= 1) { 
                    if(selectedGame === 'go' && r.goSize !== goSize) continue; // 囲碁の場合はサイズが同じ部屋
                    matchedId = id; break; 
                } 
            } 
        }
        
        if (matchedId) {
            const p1Id = Object.keys(rooms[matchedId].players)[0];
            const myAssignedRole = Math.random() < 0.5 ? "X" : "O";
            const p1AssignedRole = myAssignedRole === "X" ? "O" : "X";
            
            db.ref(`match_rooms/${matchedId}`).update({
                [`players/${p1Id}/role`]: p1AssignedRole,
                [`players/${myId}`]: { name: userData.name, role: myAssignedRole },
                status: 'playing'
            });
            enterOnlineGame(matchedId, myAssignedRole);
        } else {
            const newRoomRef = roomsRef.push();
            currentRoomId = newRoomRef.key;
            newRoomRef.set({
                gameType: selectedGame, status: 'waiting', hostRankIndex: myRank, password: null,
                goSize: goSize,
                handicap: handicap,
                board: getInitialBoard(selectedGame), currentPlayer: handicap > 0 ? "O" : "X", winner: null, isDraw: false,
                captured: { X: 0, O: 0 },
                players: { [myId]: { name: userData.name, role: "pending" } }
            });
            newRoomRef.onDisconnect().remove();
            enterOnlineGame(currentRoomId, "pending");
        }
    });
});

// プライベートマッチ作成
document.getElementById('createPrivateRoomBtn').addEventListener('click', () => {
    const pw = document.getElementById('roomPasswordInput').value.trim();
    if(!pw) { document.getElementById('privateRoomError').textContent = "合言葉を入力してください"; return; }
    
    currentMode = 'online'; switchScreen('matchingScreen');
    document.getElementById('matchingText').textContent = "接続中... (合言葉: " + pw + ")";
    
    let goSize = null, handicap = 0;
    if(selectedGame === 'go') {
        goSize = parseInt(document.getElementById('goSizeSelect').value);
        handicap = parseInt(document.getElementById('goHandicap').value);
    }

    const newRoomRef = roomsRef.push();
    currentRoomId = newRoomRef.key;
    newRoomRef.set({
        gameType: selectedGame, status: 'waiting', password: pw,
        goSize: goSize,
        handicap: handicap,
        board: getInitialBoard(selectedGame), currentPlayer: handicap > 0 ? "O" : "X", winner: null, isDraw: false,
        captured: { X: 0, O: 0 },
        players: { [myId]: { name: userData.name, role: "pending" } }
    });
    newRoomRef.onDisconnect().remove();
    enterOnlineGame(currentRoomId, "pending");
});

// プライベートマッチ入室
document.getElementById('joinPrivateRoomBtn').addEventListener('click', () => {
    const pw = document.getElementById('roomPasswordInput').value.trim();
    if(!pw) { document.getElementById('privateRoomError').textContent = "合言葉を入力してください"; return; }

    roomsRef.orderByChild('password').equalTo(pw).once('value', snapshot => {
        const rooms = snapshot.val();
        let targetId = null;
        if (rooms) {
            for (let id in rooms) {
                if(rooms[id].status === 'waiting' && rooms[id].gameType === selectedGame) { targetId = id; break; }
            }
        }
        
        if (targetId) {
            currentMode = 'online';
            const p1Id = Object.keys(rooms[targetId].players)[0];
            const myAssignedRole = Math.random() < 0.5 ? "X" : "O";
            const p1AssignedRole = myAssignedRole === "X" ? "O" : "X";
            
            db.ref(`match_rooms/${targetId}`).update({
                [`players/${p1Id}/role`]: p1AssignedRole,
                [`players/${myId}`]: { name: userData.name, role: myAssignedRole },
                status: 'playing'
            });
            enterOnlineGame(targetId, myAssignedRole);
        } else {
            document.getElementById('privateRoomError').textContent = "その部屋は存在しません";
        }
    });
});

document.getElementById('cancelMatchBtn').addEventListener('click', () => { if (currentRoomId) db.ref(`match_rooms/${currentRoomId}`).remove(); switchScreen('modeSelectScreen'); });

function leaveGame() {
    if (currentRoomId && currentMode === 'online') { 
        db.ref(`match_rooms/${currentRoomId}`).off('value', gameListener); 
        if (chatListener) db.ref(`match_rooms/${currentRoomId}/chat`).off('value', chatListener);
        if (myRole !== "spectator") db.ref(`match_rooms/${currentRoomId}`).remove(); 
    }
    currentRoomId = null; currentMode = null; myRole = null; chatListener = null;
    switchScreen('gameSelectScreen');
}
document.getElementById('leaveGameBtn').addEventListener('click', leaveGame);

function enterOnlineGame(roomId, initialRole) {
    currentRoomId = roomId; myRole = initialRole;
    document.getElementById('chatArea').classList.remove('hidden');

    gameListener = db.ref(`match_rooms/${roomId}`).on('value', snap => {
        const data = snap.val();
        if (!data) return leaveGame(); 
        if (data.status === 'playing') {
            switchScreen('gameScreen');
            if (myRole === "pending") myRole = data.players[myId].role;
            if (selectedGame === 'chess' && chessEngine) chessEngine.load(data.board); 
            
            // 状態をグローバルに持たせる(ローカルと統一)
            window.currentGameState = data;
            renderBoard(data);
            
            if (data.winner === myRole && myRole !== "spectator" && !data._pointsAwarded && userData.points[selectedGame] !== undefined) { 
                userData.points[selectedGame] += 50; saveUser(); 
                db.ref(`match_rooms/${roomId}/_pointsAwarded`).set(true);
            }
        }
    });

    chatListener = db.ref(`match_rooms/${roomId}/chat`).on('value', snap => {
        const chatBox = document.getElementById('chatMessages');
        chatBox.innerHTML = '';
        const chats = snap.val();
        if (chats) {
            Object.values(chats).forEach(msg => {
                const div = document.createElement('div');
                div.className = msg.sender === 'システム' ? 'chat-message system' : 'chat-message';
                div.innerHTML = msg.sender === 'システム' ? msg.text : `<strong>${msg.sender}:</strong> ${msg.text}`;
                chatBox.appendChild(div);
            });
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    });
}

document.getElementById('sendChatBtn').addEventListener('click', sendChatMsg);
document.getElementById('chatInput').addEventListener('keypress', (e) => { if(e.key === 'Enter') sendChatMsg(); });

function sendChatMsg() {
    const text = document.getElementById('chatInput').value.trim();
    if (text && currentRoomId && currentMode === 'online') {
        db.ref(`match_rooms/${currentRoomId}/chat`).push({ sender: userData.name, text: text });
        document.getElementById('chatInput').value = '';
    }
}

function getPlayerName(role, gameType) {
    if (gameType === 'othello' || gameType === 'go') return role === 'X' ? '黒' : '白';
    else if (gameType === 'chess') return role === 'X' ? '白' : '黒'; 
    else return role === 'X' ? '✕' : '〇';
}

// --- 投了・パス機能 ---
document.getElementById('resignBtn').addEventListener('click', () => {
    let state = window.currentGameState;
    if(!state || state.winner) return;
    
    // 自分がXならOの勝ち。ローカルなら現在のプレイヤーの負け。
    let loser = myRole;
    if(currentMode === 'local' || myRole === 'spectator') loser = state.currentPlayer;
    state.winner = loser === 'X' ? 'O' : 'X';
    
    if (currentMode === 'online') {
        db.ref(`match_rooms/${currentRoomId}/chat`).push({ sender: 'システム', text: `【 ${getPlayerName(loser, selectedGame)} 】が投了しました。` });
    }
    syncGameState(state, state.board);
});

document.getElementById('passBtn').addEventListener('click', () => {
    let state = window.currentGameState;
    if(!state || state.winner || selectedGame !== 'go') return;
    if(currentMode === 'online' && myRole !== state.currentPlayer) return;

    if (currentMode === 'online') {
        db.ref(`match_rooms/${currentRoomId}/chat`).push({ sender: 'システム', text: `【 ${getPlayerName(state.currentPlayer, selectedGame)} 】がパスしました。` });
    }
    state.currentPlayer = state.currentPlayer === "X" ? "O" : "X";
    syncGameState(state, state.board);
});

// --- 描画エンジン ---
const chessPieces = { 'p':'♟', 'n':'♞', 'b':'♝', 'r':'♜', 'q':'♛', 'k':'♚', 'P':'♙', 'N':'♘', 'B':'♗', 'R':'♖', 'Q':'♕', 'K':'♔' };

function renderBoard(gameState) {
    window.currentGameState = gameState; // 状態保持
    const boardElement = document.getElementById('board');
    boardElement.className = `board ${selectedGame}`;
    boardElement.innerHTML = '';
    
    const isMyTurn = (currentMode === 'local') || (myRole === gameState.currentPlayer);
    const turnClass = `turn-${gameState.currentPlayer.toLowerCase()}`;
    boardElement.classList.add(turnClass); // 手番クラスを追加 (囲碁のホバー用)
    
    // UI出し分け
    document.getElementById('resignBtn').classList.toggle('hidden', gameState.winner != null);
    document.getElementById('passBtn').classList.toggle('hidden', selectedGame !== 'go' || gameState.winner != null || !isMyTurn);
    
    let starPoints = [];
    if(selectedGame === 'go') {
        document.getElementById('goCapturedDisplay').classList.remove('hidden');
        document.getElementById('capBlack').textContent = gameState.captured ? gameState.captured.X : 0;
        document.getElementById('capWhite').textContent = gameState.captured ? gameState.captured.O : 0;
        const s = gameState.goSize || 19; // デフォルト19路
        starPoints = getStarPoints(s);
        
        // 路盤サイズに応じたグリッド設定とセルサイズ
        let cellSize = 22; // 19路
        if (s === 9) cellSize = 40;
        if (s === 13) cellSize = 30;
        
        boardElement.style.gridTemplateColumns = `repeat(${s}, ${cellSize}px)`;
        boardElement.style.gridTemplateRows = `repeat(${s}, ${cellSize}px)`;
    } else {
        document.getElementById('goCapturedDisplay').classList.add('hidden');
        boardElement.style.gridTemplateColumns = "";
        boardElement.style.gridTemplateRows = "";
    }

    if (selectedGame === 'chess') {
        const board2D = chessEngine.board(); 
        let validMoves = [];
        if (chessSelectedSquare && isMyTurn) {
            validMoves = chessEngine.moves({ square: chessSelectedSquare, verbose: true }).map(m => m.to);
        }

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const cell = document.createElement('div');
                const squareName = String.fromCharCode(97 + c) + (8 - r); 
                cell.className = `cell ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
                
                if (chessSelectedSquare === squareName) cell.classList.add('selected');
                if (validMoves.includes(squareName)) cell.classList.add('valid-move');
                
                const piece = board2D[r][c];
                if (piece) {
                    const char = piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
                    cell.textContent = chessPieces[char];
                    cell.style.color = piece.color === 'w' ? 'white' : 'black';
                    cell.style.textShadow = piece.color === 'w' ? '0 0 2px black' : '0 0 2px white';
                }
                cell.addEventListener('click', () => handleChessClick(squareName, gameState));
                boardElement.appendChild(cell);
            }
        }
    } else {
        const size = gameState.goSize || (selectedGame === 'go' ? 19 : Math.sqrt(gameState.board.length));
        
        gameState.board.forEach((val, idx) => {
            const cell = document.createElement('div');
            cell.className = 'cell ' + (val ? val.toLowerCase() : '');
            
            const x = idx % size;
            const y = Math.floor(idx / size);
            
            // オセロのヒント
            if (selectedGame === 'othello' && isMyTurn && val === "") {
                if (getOthelloFlipped(gameState.board, idx, gameState.currentPlayer).length > 0) {
                    cell.classList.add('valid-move');
                }
            }

            // --- 囲碁のビジュアル強化ロジック ---
            if (selectedGame === 'go') {
                // 星と天元の描画
                if (starPoints.some(pt => pt.x === x && pt.y === y)) {
                    cell.classList.add('star-point');
                    const dot = document.createElement('div');
                    dot.className = 'star-dot';
                    cell.appendChild(dot);
                }
                
                // ホバー時に石を表示するためのプレースホルダー
                const stone = document.createElement('div');
                stone.className = 'stone';
                if (!val) { 
                    // 石がない場合のみホバー用に準備
                    if (isMyTurn && !gameState.winner) {
                        cell.classList.add('can-move');
                    }
                }
                cell.appendChild(stone);
                
            } else if (selectedGame !== 'othello') {
                // 〇✕ゲームなど
                cell.textContent = val;
            }
            
            cell.addEventListener('click', () => handleCellClick(idx, gameState));
            boardElement.appendChild(cell);
        });
    }

    const st = document.getElementById('status');
    if (gameState.winner) {
        st.textContent = `🎉 【 ${getPlayerName(gameState.winner, selectedGame)} 】 の勝利！`;
    } else if (gameState.isDraw) {
        st.textContent = "🤝 引き分け！";
    } else {
        if (currentMode === 'local') {
            st.textContent = `【 ${getPlayerName(gameState.currentPlayer, selectedGame)} 】の番です`;
        } else {
            st.textContent = isMyTurn ? "あなたの番です" : "相手の番です";
        }
    }

    const roleDisplay = document.getElementById('myRoleDisplay');
    if (currentMode === 'local') roleDisplay.textContent = "ローカル対戦（交代で操作）";
    else if (currentMode === 'ai') roleDisplay.textContent = `VS コンピュータ (あなたは 【 ${getPlayerName('X', selectedGame)} 】)`;
    else {
        if (myRole === 'spectator' || !myRole || myRole === 'pending') roleDisplay.textContent = "観戦中 / 待機中";
        else roleDisplay.textContent = `オンライン対戦 (あなたは 【 ${getPlayerName(myRole, selectedGame)} 】)`;
    }
}

// --- 操作とAI判定 ---
function handleChessClick(square, gameState) {
    if (currentMode === 'online' && myRole !== gameState.currentPlayer) return;
    if (currentMode === 'ai' && gameState.currentPlayer !== 'X') return;
    if (gameState.winner) return;

    const engineColor = chessEngine.turn() === 'w' ? 'X' : 'O';
    if (engineColor !== gameState.currentPlayer) return;

    if (!chessSelectedSquare) {
        const piece = chessEngine.get(square);
        if (piece && piece.color === chessEngine.turn()) { chessSelectedSquare = square; renderBoard(gameState); }
    } else {
        const move = chessEngine.move({ from: chessSelectedSquare, to: square, promotion: 'q' });
        if (move) {
            chessSelectedSquare = null;
            playSE('put');
            syncGameState(gameState, chessEngine.fen());
        } else {
            const piece = chessEngine.get(square);
            if (piece && piece.color === chessEngine.turn()) chessSelectedSquare = square;
            else chessSelectedSquare = null; 
            renderBoard(gameState);
        }
    }
}

function handleCellClick(idx, gameState) {
    if (currentMode === 'online' && myRole !== gameState.currentPlayer) return;
    if (currentMode === 'ai' && gameState.currentPlayer !== 'X') return;
    if (gameState.winner || gameState.board[idx] !== "") return;

    if (selectedGame === 'othello') {
        const flipped = getOthelloFlipped(gameState.board, idx, gameState.currentPlayer);
        if (flipped.length === 0) return;
        flipped.forEach(fIdx => gameState.board[fIdx] = gameState.currentPlayer);
        gameState.board[idx] = gameState.currentPlayer;
    } else if (selectedGame === 'go') {
        let newBoard = [...gameState.board];
        newBoard[idx] = gameState.currentPlayer;
        const opp = gameState.currentPlayer === "X" ? "O" : "X";
        const size = gameState.goSize || 19;
        let capturedCount = 0;
        
        // 相手の石を囲んだら取る
        for (let i = 0; i < size * size; i++) {
            if (newBoard[i] === opp && getLiberties(newBoard, i, opp, size) === 0) { 
                capturedCount += removeGroup(newBoard, i, opp, size); 
            }
        }
        // 自殺手防止 (ただし、相手の石を取れる場合は自殺手ではない)
        if (capturedCount === 0 && getLiberties(newBoard, idx, gameState.currentPlayer, size) === 0) return; 
        
        gameState.board = newBoard;
        if(capturedCount > 0) {
            if(!gameState.captured) gameState.captured = { X: 0, O: 0 };
            gameState.captured[gameState.currentPlayer] += capturedCount;
        }
    } else {
        gameState.board[idx] = gameState.currentPlayer;
    }
    
    playSE('put');
    syncGameState(gameState, gameState.board);
}

function syncGameState(gameState, newBoardData) {
    // 投了などで winner が既に決まっている場合は飛ばす
    if(!gameState.winner && !gameState.isDraw) {
        gameState.board = newBoardData;
        let nextPlayer = gameState.currentPlayer === "X" ? "O" : "X";

        if (selectedGame === 'chess') {
            if (chessEngine.in_checkmate()) gameState.winner = gameState.currentPlayer;
            else if (chessEngine.in_draw()) gameState.isDraw = true;
            gameState.currentPlayer = nextPlayer;
        } else if (selectedGame === 'tictactoe') {
            const wp = [[0,1,2], [3,4,5], [6,7,8], [0,3,6], [1,4,7], [2,5,8], [0,4,8], [2,4,6]];
            for (let p of wp) if (gameState.board[p[0]] && gameState.board[p[0]] === gameState.board[p[1]] && gameState.board[p[0]] === gameState.board[p[2]]) gameState.winner = gameState.board[p[0]];
            if (!gameState.winner && !gameState.board.includes("")) gameState.isDraw = true;
            gameState.currentPlayer = nextPlayer;
        } else if (selectedGame === 'othello') {
            const xCnt = gameState.board.filter(c => c === "X").length;
            const oCnt = gameState.board.filter(c => c === "O").length;
            const nextHasMoves = hasOthelloValidMoves(gameState.board, nextPlayer);
            const currentHasMoves = hasOthelloValidMoves(gameState.board, gameState.currentPlayer);

            if (!gameState.board.includes("") || xCnt === 0 || oCnt === 0 || (!nextHasMoves && !currentHasMoves)) {
                gameState.winner = xCnt > oCnt ? "X" : (oCnt > xCnt ? "O" : null);
                if (xCnt === oCnt) gameState.isDraw = true;
                gameState.currentPlayer = nextPlayer; 
            } else {
                if (nextHasMoves) {
                    gameState.currentPlayer = nextPlayer;
                } else {
                    if (currentMode === 'online') {
                        db.ref(`match_rooms/${currentRoomId}/chat`).push({ 
                            sender: 'システム', 
                            text: `【 ${getPlayerName(nextPlayer, selectedGame)} 】は置ける場所がないためパスしました。` 
                        });
                    }
                }
            }
        } else if (selectedGame === 'go') {
            gameState.currentPlayer = nextPlayer;
        }
    }

    const updateData = {
        board: gameState.board,
        currentPlayer: gameState.currentPlayer,
        winner: gameState.winner || null,
        isDraw: gameState.isDraw || false,
        captured: gameState.captured || { X: 0, O: 0 }
    };

    if (currentMode === 'online') {
        db.ref(`match_rooms/${currentRoomId}`).update(updateData);
    } else {
        renderBoard(gameState);
        if (currentMode === 'ai' && !gameState.winner && !gameState.isDraw && gameState.currentPlayer === 'O') setTimeout(() => playAI(gameState), 800);
        if (currentMode === 'ai' && gameState.winner === 'X' && userData.points[selectedGame] !== undefined) { userData.points[selectedGame] += 50; saveUser(); }
    }
}

// --- AI ロジック ---
function playAI(gameState) {
    if (selectedGame === 'chess') {
        const moves = chessEngine.moves();
        if (moves.length === 0) return;
        chessEngine.move(moves[Math.floor(Math.random() * moves.length)]);
        playSE('put');
        syncGameState(gameState, chessEngine.fen());
        return;
    }

    let emptySpots = gameState.board.map((v, i) => v === "" ? i : null).filter(v => v !== null);
    if (emptySpots.length === 0) {
        if(selectedGame === 'go') {
            // 置く場所がない場合AIはパス
            gameState.currentPlayer = "X";
            syncGameState(gameState, gameState.board);
        }
        return;
    }
    
    let moveIdx = -1;
    if (selectedGame === 'othello') {
        let maxF = 0;
        for (let i of emptySpots) { let f = getOthelloFlipped(gameState.board, i, "O").length; if (f > maxF) { maxF = f; moveIdx = i; } }
        if (moveIdx !== -1) {
            getOthelloFlipped(gameState.board, moveIdx, "O").forEach(fIdx => gameState.board[fIdx] = "O");
            gameState.board[moveIdx] = "O";
        }
    } else if (selectedGame === 'go') {
        const size = gameState.goSize || 19;
        
        // 置き石周辺を優先する簡易的なロジック
        if(gameState.handicap > 0 && gameState.board.filter(c=>c==='O').length < 3) {
            // ゲーム序盤は石の近くを狙う
            const myStones = gameState.board.map((v, i) => v === "O" ? i : null).filter(v => v !== null);
            let nearbySpots = [];
            if(myStones.length > 0){
                for(let sIdx of myStones) {
                    const sx = sIdx % size, sy = Math.floor(sIdx / size);
                    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
                    for(let [dx,dy] of dirs){
                        let nx = sx+dx, ny = sy+dy;
                        if(nx>=0 && nx<size && ny>=0 && ny<size){
                            let nIdx = ny*size+nx;
                            if(gameState.board[nIdx] === "") nearbySpots.push(nIdx);
                        }
                    }
                }
            }
            if(nearbySpots.length > 0) emptySpots = nearbySpots; // 近くの空き地を優先
        }

        for(let i=0; i<50; i++) {
            let r = emptySpots[Math.floor(Math.random() * emptySpots.length)];
            let test = [...gameState.board]; test[r] = "O";
            if (getLiberties(test, r, "O", size) > 0) { moveIdx = r; break; } // 自殺手でなければ採用
        }
        
        if(moveIdx !== -1) {
            let nb = [...gameState.board]; nb[moveIdx] = "O"; 
            
            // 相手石を取る処理(AI)
            let capturedCount = 0;
            for (let i = 0; i < size * size; i++) {
                if (nb[i] === "X" && getLiberties(nb, i, "X", size) === 0) { 
                    capturedCount += removeGroup(nb, i, "X", size); 
                }
            }
            if(capturedCount > 0) {
                if(!gameState.captured) gameState.captured = { X: 0, O: 0 };
                gameState.captured["O"] += capturedCount;
            }
            gameState.board = nb;
        } else {
             // 良い手が見つからない場合AIはパス
            gameState.currentPlayer = "X";
            syncGameState(gameState, gameState.board);
            return;
        }
    } else {
        // 〇✕ゲームなど
        moveIdx = emptySpots[Math.floor(Math.random() * emptySpots.length)];
        gameState.board[moveIdx] = "O";
    }

    if (moveIdx !== -1) {
        playSE('put');
        syncGameState(gameState, gameState.board);
    }
}

// --- ユーティリティ ---
function hasOthelloValidMoves(board, player) {
    for (let i = 0; i < 64; i++) {
        if (board[i] === "" && getOthelloFlipped(board, i, player).length > 0) return true;
    }
    return false;
}

function getOthelloFlipped(board, index, player) {
    const opp = player === "X" ? "O" : "X"; let flipped = []; const dirs = [[-1,-1], [-1,0], [-1,1], [0,-1], [0,1], [1,-1], [1,0], [1,1]];
    const x = index % 8, y = Math.floor(index / 8);
    for (let [dx, dy] of dirs) {
        let nx = x + dx, ny = y + dy, temp = [];
        while (nx >= 0 && nx < 8 && ny >= 0 && ny < 8) {
            let nIdx = ny * 8 + nx;
            if (board[nIdx] === opp) temp.push(nIdx);
            else if (board[nIdx] === player) { flipped.push(...temp); break; }
            else break; nx += dx; ny += dy;
        }
    } return flipped;
}

// 囲碁：呼吸点（ダメ）の数を計算
function getLiberties(board, idx, player, size = 19, visited = new Set()) {
    if (visited.has(idx)) return 0; visited.add(idx);
    const x = idx % size, y = Math.floor(idx / size); let lib = 0;
    const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
    for (let [dx, dy] of dirs) {
        let nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
            let nIdx = ny * size + nx;
            if (board[nIdx] === "") lib++; // 空き地＝呼吸点
            else if (board[nIdx] === player) lib += getLiberties(board, nIdx, player, size, visited); // 味方の石なら繋がっている
        }
    } return lib;
}

// 囲碁：死に石のグループを削除し、数を返す
function removeGroup(board, idx, player, size = 19, visited = new Set()) {
    if (visited.has(idx) || board[idx] !== player) return 0;
    visited.add(idx); board[idx] = ""; // 石を取り除く
    let removedCount = 1;
    const x = idx % size, y = Math.floor(idx / size); const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
    for (let [dx, dy] of dirs) {
        let nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
            removedCount += removeGroup(board, ny * size + nx, player, size, visited);
        }
    }
    return removedCount;
}