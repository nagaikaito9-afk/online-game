// --- Firebase初期設定 ---
const firebaseConfig = {
    apiKey: "AIzaSyDmP5Mhy9OINCQ3IiQAY9y9FuQh2OwRcRc",
    authDomain: "online-game-73f50.firebaseapp.com",
    databaseURL: "https://online-game-73f50-default-rtdb.firebaseio.com", 
    projectId: "online-game-73f50"
};
firebase.initializeApp(firebaseConfig);
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
        const pts = userData.points[g] || 0;
        document.getElementById(`rank-${g}`).textContent = `ランク: ${getRank(pts).name}`; 
        
        // プログレスバーの更新 (100ポイントで次ランク。余りが進行度(%))
        // ※ただし最大ランクの場合は常に100%にする
        const progress = (pts >= 1900) ? 100 : (pts % 100);
        document.getElementById(`progress-${g}`).style.width = `${progress}%`;
    });
}
updateUI();

// --- 画面遷移・モーダル ---
function switchScreen(screenId) {
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
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

let selectedGame = null, currentMode = null, currentRoomId = null, myRole = null, gameListener = null;
let chessEngine = null; 
let chessSelectedSquare = null; 
const GAME_NAMES = { tictactoe: "〇✕ゲーム", othello: "オセロ", chess: "チェス", go: "囲碁" };

document.querySelectorAll('.btn-game').forEach(btn => {
    btn.addEventListener('click', (e) => {
        selectedGame = e.currentTarget.dataset.game;
        document.getElementById('selectedGameTitle').textContent = GAME_NAMES[selectedGame];
        document.getElementById('currentRankDisplay').textContent = `現在: ${getRank(userData.points[selectedGame] || 0).name}`;
        switchScreen('modeSelectScreen');
    });
});

// --- ゲーム初期化と同期設定 ---
function getInitialBoard(type) {
    if (type === 'tictactoe') return Array(9).fill("");
    if (type === 'othello') { let b = Array(64).fill(""); b[27]="O"; b[28]="X"; b[35]="X"; b[36]="O"; return b; }
    if (type === 'chess') { chessEngine = new Chess(); chessSelectedSquare = null; return chessEngine.fen(); } 
    if (type === 'go') return Array(81).fill("");
}

document.getElementById('modeLocalBtn').addEventListener('click', () => { currentMode = 'local'; myRole = 'local'; startLocalGame(); });
document.getElementById('modeAIBtn').addEventListener('click', () => { currentMode = 'ai'; myRole = 'w'; startLocalGame(); }); 

function startLocalGame() {
    switchScreen('gameScreen');
    document.getElementById('matchTitle').textContent = currentMode === 'ai' ? "VS コンピュータ" : "近くの人と対戦";
    myRole = (selectedGame === 'chess' || selectedGame === 'go') && currentMode === 'ai' ? 'X' : myRole; 
    let state = { board: getInitialBoard(selectedGame), currentPlayer: "X", winner: null, isDraw: false };
    renderBoard(state);
}

document.getElementById('modeOnlineBtn').addEventListener('click', () => {
    currentMode = 'online'; switchScreen('matchingScreen');
    const myRank = getRank(userData.points[selectedGame]||0).index;
    roomsRef.orderByChild('status').equalTo('waiting').once('value', snapshot => {
        const rooms = snapshot.val(); let matchedId = null;
        if (rooms) { for (let id in rooms) { if (rooms[id].gameType === selectedGame && Math.abs(rooms[id].hostRankIndex - myRank) <= 1) { matchedId = id; break; } } }
        if (matchedId) {
            const p1Id = Object.keys(rooms[matchedId].players)[0];
            const myAssignedRole = Math.random() < 0.5 ? "X" : "O";
            db.ref(`match_rooms/${matchedId}/players/${p1Id}/role`).set(myAssignedRole === "X" ? "O" : "X");
            db.ref(`match_rooms/${matchedId}/players/${myId}`).set({ name: userData.name, role: myAssignedRole });
            db.ref(`match_rooms/${matchedId}/status`).set('playing');
            enterOnlineGame(matchedId, myAssignedRole);
        } else {
            const newRoomRef = roomsRef.push();
            currentRoomId = newRoomRef.key;
            newRoomRef.set({
                gameType: selectedGame, status: 'waiting', hostRankIndex: myRank,
                board: getInitialBoard(selectedGame), currentPlayer: "X", winner: null, isDraw: false,
                players: { [myId]: { name: userData.name, role: "pending" } }
            });
            newRoomRef.onDisconnect().remove();
            enterOnlineGame(currentRoomId, "pending");
        }
    });
});
document.getElementById('cancelMatchBtn').addEventListener('click', () => { if (currentRoomId) db.ref(`match_rooms/${currentRoomId}`).remove(); switchScreen('modeSelectScreen'); });

function enterOnlineGame(roomId, initialRole) {
    currentRoomId = roomId; myRole = initialRole;
    gameListener = db.ref(`match_rooms/${roomId}`).on('value', snap => {
        const data = snap.val();
        if (!data) return leaveGame();
        if (data.status === 'playing') {
            switchScreen('gameScreen');
            if (myRole === "pending") myRole = data.players[myId].role;
            if (selectedGame === 'chess' && chessEngine) chessEngine.load(data.board); 
            renderBoard(data);
            if (data.winner === myRole && myRole !== "spectator") { userData.points[selectedGame] += 50; saveUser(); }
        }
    });
}

// --- 描画エンジン ---
const chessPieces = { 'p':'♟', 'n':'♞', 'b':'♝', 'r':'♜', 'q':'♛', 'k':'♚', 'P':'♙', 'N':'♘', 'B':'♗', 'R':'♖', 'Q':'♕', 'K':'♔' };

function renderBoard(gameState) {
    const boardElement = document.getElementById('board');
    boardElement.className = `board ${selectedGame}`;
    boardElement.innerHTML = '';
    
    // 自分のターンのときだけハイライトを表示する
    const isMyTurn = (currentMode === 'local') || (myRole === gameState.currentPlayer);
    
    if (selectedGame === 'chess') {
        const board2D = chessEngine.board(); 
        let validMoves = [];
        
        // もし駒を選択中なら、動かせる場所（to）のリストを取得
        if (chessSelectedSquare && isMyTurn) {
            validMoves = chessEngine.moves({ square: chessSelectedSquare, verbose: true }).map(m => m.to);
        }

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const cell = document.createElement('div');
                const squareName = String.fromCharCode(97 + c) + (8 - r); 
                cell.className = `cell ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
                
                if (chessSelectedSquare === squareName) cell.classList.add('selected');
                // 動かせる場所ならマークをつける
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
        gameState.board.forEach((val, idx) => {
            const cell = document.createElement('div');
            cell.className = 'cell ' + (val ? val.toLowerCase() : '');
            
            // オセロのハイライト表示（自分の番で、かつ空マスで、かつ裏返せる石がある場合）
            if (selectedGame === 'othello' && isMyTurn && val === "") {
                if (getOthelloFlipped(gameState.board, idx, gameState.currentPlayer).length > 0) {
                    cell.classList.add('valid-move');
                }
            }

            if (selectedGame === 'go') {
                if (val) { const stone = document.createElement('div'); stone.className = 'stone'; cell.appendChild(stone); }
            } else if (selectedGame !== 'othello') {
                cell.textContent = val;
            }
            cell.addEventListener('click', () => handleCellClick(idx, gameState));
            boardElement.appendChild(cell);
        });
    }

    const st = document.getElementById('status');
    if (gameState.winner) st.textContent = `🎉 ${gameState.winner} の勝利！`;
    else if (gameState.isDraw) st.textContent = "🤝 引き分け！";
    else st.textContent = isMyTurn ? "あなたの番です" : "相手の番です";
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
            // 間違った場所をクリックした場合、それが自分の別の駒なら選択を切り替える
            const piece = chessEngine.get(square);
            if (piece && piece.color === chessEngine.turn()) {
                chessSelectedSquare = square;
            } else {
                chessSelectedSquare = null; // それ以外なら選択解除
            }
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
    } else if (selectedGame === 'go') {
        let newBoard = [...gameState.board];
        newBoard[idx] = gameState.currentPlayer;
        const opp = gameState.currentPlayer === "X" ? "O" : "X";
        let captured = false;
        for (let i = 0; i < 81; i++) {
            if (newBoard[i] === opp && getLiberties(newBoard, i, opp) === 0) { removeGroup(newBoard, i, opp); captured = true; }
        }
        if (!captured && getLiberties(newBoard, idx, gameState.currentPlayer) === 0) return; 
        gameState.board = newBoard;
    }
    
    playSE('put');
    gameState.board[selectedGame === 'go' ? -1 : idx] = gameState.currentPlayer; 
    syncGameState(gameState, gameState.board);
}

function syncGameState(gameState, newBoardData) {
    gameState.board = newBoardData;
    
    if (selectedGame === 'chess') {
        if (chessEngine.in_checkmate()) gameState.winner = gameState.currentPlayer;
        else if (chessEngine.in_draw()) gameState.isDraw = true;
    } else if (selectedGame === 'tictactoe') {
        const wp = [[0,1,2], [3,4,5], [6,7,8], [0,3,6], [1,4,7], [2,5,8], [0,4,8], [2,4,6]];
        for (let p of wp) if (gameState.board[p[0]] && gameState.board[p[0]] === gameState.board[p[1]] && gameState.board[p[0]] === gameState.board[p[2]]) gameState.winner = gameState.board[p[0]];
        if (!gameState.winner && !gameState.board.includes("")) gameState.isDraw = true;
    } else if (selectedGame === 'othello') {
        if (!gameState.board.includes("")) {
            const x = gameState.board.filter(c => c === "X").length, o = gameState.board.filter(c => c === "O").length;
            gameState.winner = x > o ? "X" : (o > x ? "O" : null); if(x === o) gameState.isDraw = true;
        }
    }

    gameState.currentPlayer = gameState.currentPlayer === "X" ? "O" : "X";

    if (currentMode === 'online') {
        db.ref(`match_rooms/${currentRoomId}`).update({ board: gameState.board, currentPlayer: gameState.currentPlayer, winner: gameState.winner, isDraw: gameState.isDraw });
    } else {
        renderBoard(gameState);
        if (currentMode === 'ai' && !gameState.winner && !gameState.isDraw && gameState.currentPlayer === 'O') setTimeout(() => playAI(gameState), 800);
        if (currentMode === 'ai' && gameState.winner === 'X') { userData.points[selectedGame] += 50; saveUser(); }
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
    if (emptySpots.length === 0) return;
    
    let moveIdx = -1;
    if (selectedGame === 'othello') {
        let maxF = 0;
        for (let i of emptySpots) { let f = getOthelloFlipped(gameState.board, i, "O").length; if (f > maxF) { maxF = f; moveIdx = i; } }
        if (moveIdx !== -1) getOthelloFlipped(gameState.board, moveIdx, "O").forEach(fIdx => gameState.board[fIdx] = "O");
        else { gameState.currentPlayer = "X"; return renderBoard(gameState); } 
    } else if (selectedGame === 'go') {
        for(let i=0; i<50; i++) {
            let r = emptySpots[Math.floor(Math.random() * emptySpots.length)];
            let test = [...gameState.board]; test[r] = "O";
            if (getLiberties(test, r, "O") > 0) { moveIdx = r; break; }
        }
        if(moveIdx === -1) { gameState.currentPlayer = "X"; return renderBoard(gameState); } 
    } else {
        moveIdx = emptySpots[Math.floor(Math.random() * emptySpots.length)];
    }

    playSE('put');
    if(selectedGame !== 'go') gameState.board[moveIdx] = "O";
    else { let nb = [...gameState.board]; nb[moveIdx] = "O"; gameState.board = nb; } 
    syncGameState(gameState, gameState.board);
}

// --- ユーティリティ (オセロ・囲碁) ---
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

function getLiberties(board, idx, player, visited = new Set()) {
    if (visited.has(idx)) return 0; visited.add(idx);
    const x = idx % 9, y = Math.floor(idx / 9); let lib = 0;
    const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
    for (let [dx, dy] of dirs) {
        let nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < 9 && ny >= 0 && ny < 9) {
            let nIdx = ny * 9 + nx;
            if (board[nIdx] === "") lib++;
            else if (board[nIdx] === player) lib += getLiberties(board, nIdx, player, visited);
        }
    } return lib;
}
function removeGroup(board, idx, player, visited = new Set()) {
    if (visited.has(idx) || board[idx] !== player) return;
    visited.add(idx); board[idx] = "";
    const x = idx % 9, y = Math.floor(idx / 9); const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
    for (let [dx, dy] of dirs) {
        let nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < 9 && ny >= 0 && ny < 9) removeGroup(board, ny * 9 + nx, player, visited);
    }
}

// 退出処理
document.getElementById('leaveGameBtn').addEventListener('click', () => {
    if (currentRoomId && currentMode === 'online') { db.ref(`match_rooms/${currentRoomId}`).off('value', gameListener); if (myRole !== "spectator") db.ref(`match_rooms/${currentRoomId}`).remove(); }
    currentRoomId = null; currentMode = null; switchScreen('gameSelectScreen');
});