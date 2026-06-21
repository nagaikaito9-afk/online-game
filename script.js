// --- 1. Firebaseの初期設定 ---
const firebaseConfig = {
    apiKey: "AIzaSyDmP5Mhy9OINCQ3IiQAY9y9FuQh2OwRcRc",
    authDomain: "online-game-73f50.firebaseapp.com",
    databaseURL: "https://online-game-73f50-default-rtdb.firebaseio.com", 
    projectId: "online-game-73f50",
    storageBucket: "online-game-73f50.firebasestorage.app",
    messagingSenderId: "104638669896",
    appId: "1:104638669896:web:22ff1bd9f781bdd619e47d"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const roomsRef = db.ref('match_rooms');

// --- 2. ランクシステムとユーザー管理 ---
const RANKS = [
    "ブロンズ I", "ブロンズ II", "ブロンズ III",
    "シルバー I", "シルバー II", "シルバー III",
    "ゴールド I", "ゴールド II", "ゴールド III",
    "プラチナ I", "プラチナ II", "プラチナ III",
    "ダイアモンド I", "ダイアモンド II", "ダイアモンド III",
    "マスター I", "マスター II", "マスター III", "マスター IV", "マスター V"
];
const POINTS_PER_RANK = 100;

// 初期データ構造
let userData = JSON.parse(localStorage.getItem('boardGameUser')) || {
    id: Math.random().toString(36).substring(2, 10),
    name: "ゲスト" + Math.floor(Math.random() * 1000),
    points: { tictactoe: 0, chess: 0, go: 0, othello: 0 }
};
const myId = userData.id;

function getRankData(pts) {
    let index = Math.floor(pts / POINTS_PER_RANK);
    if (index >= RANKS.length) index = RANKS.length - 1;
    return { name: RANKS[index], index: index };
}

function saveUser() {
    localStorage.setItem('boardGameUser', JSON.stringify(userData));
    updateUI();
}

function updateUI() {
    document.getElementById('userNameDisplay').textContent = userData.name;
    ['tictactoe', 'chess', 'go', 'othello'].forEach(game => {
        const rank = getRankData(userData.points[game]).name;
        document.getElementById(`rank-${game}`).textContent = `ランク: ${rank}`;
    });
}
updateUI();

// --- 3. 状態管理変数 ---
let selectedGame = null; // 選んだゲーム種類
let currentMode = null;  // 'local', 'online', 'ai', 'spectate'
let currentRoomId = null;
let myRole = null; 
let gameListener = null; 
let localGameState = null; // ローカル/AI用の一時データ

const GAME_NAMES = { tictactoe: "〇✕ゲーム", chess: "チェス", go: "囲碁", othello: "オセロ" };
const winPatterns = [[0,1,2], [3,4,5], [6,7,8], [0,3,6], [1,4,7], [2,5,8], [0,4,8], [2,4,6]];

// --- 4. 画面遷移とUI制御 ---
function switchScreen(screenId) {
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
}

// 名前変更モーダル制御
document.getElementById('openNameModalBtn').addEventListener('click', () => {
    document.getElementById('nameInput').value = userData.name;
    document.getElementById('nameModal').classList.remove('hidden');
});
document.getElementById('cancelNameBtn').addEventListener('click', () => {
    document.getElementById('nameModal').classList.add('hidden');
});
document.getElementById('saveNameBtn').addEventListener('click', () => {
    const newName = document.getElementById('nameInput').value.trim();
    if (newName) { userData.name = newName; saveUser(); }
    document.getElementById('nameModal').classList.add('hidden');
});

// ホームボタン類
document.querySelectorAll('.backToHomeBtn').forEach(btn => {
    btn.addEventListener('click', () => switchScreen('homeScreen'));
});
document.getElementById('gameSelectBtn').addEventListener('click', () => switchScreen('gameSelectScreen'));

// ゲーム選択
document.querySelectorAll('.btn-game').forEach(btn => {
    btn.addEventListener('click', (e) => {
        selectedGame = e.currentTarget.dataset.game;
        document.getElementById('selectedGameTitle').textContent = GAME_NAMES[selectedGame];
        const rank = getRankData(userData.points[selectedGame]).name;
        document.getElementById('currentRankDisplay').textContent = `現在: ${rank}`;
        switchScreen('modeSelectScreen');
    });
});
document.getElementById('backToGameSelectBtn').addEventListener('click', () => switchScreen('gameSelectScreen'));

// --- 5. ゲーム開始ルーチン ---

// ① 近くの人と対戦 (Local)
document.getElementById('modeLocalBtn').addEventListener('click', () => {
    if (selectedGame !== 'tictactoe') return alert("現在は〇✕ゲームのみプレイ可能です");
    currentMode = 'local';
    myRole = 'local'; // 1人で両方操作可能
    startLocalGame();
});

// ② AIと対戦 (AI)
document.getElementById('modeAIBtn').addEventListener('click', () => {
    if (selectedGame !== 'tictactoe') return alert("現在は〇✕ゲームのみプレイ可能です");
    currentMode = 'ai';
    myRole = 'X'; // 自分はX固定
    startLocalGame();
});

// ③ オンラインで対戦 (Online)
document.getElementById('modeOnlineBtn').addEventListener('click', () => {
    if (selectedGame !== 'tictactoe') return alert("現在は〇✕ゲームのみプレイ可能です");
    currentMode = 'online';
    switchScreen('matchingScreen');
    const myRankData = getRankData(userData.points[selectedGame]);

    // ランクが近い（±1）待機部屋を探す
    roomsRef.orderByChild('status').equalTo('waiting').once('value', snapshot => {
        const rooms = snapshot.val();
        let matchedRoomId = null;

        if (rooms) {
            for (let id in rooms) {
                const r = rooms[id];
                // 同じゲームで、かつランクが近い部屋を探す
                if (r.gameType === selectedGame && Math.abs(r.hostRankIndex - myRankData.index) <= 1) {
                    matchedRoomId = id;
                    break;
                }
            }
        }

        if (matchedRoomId) {
            // マッチング成功
            const p1Id = Object.keys(rooms[matchedRoomId].players)[0];
            const myAssignedRole = Math.random() < 0.5 ? "X" : "O";
            const p1Role = myAssignedRole === "X" ? "O" : "X";

            db.ref(`match_rooms/${matchedRoomId}/players/${p1Id}/role`).set(p1Role);
            db.ref(`match_rooms/${matchedRoomId}/players/${myId}`).set({ name: userData.name, role: myAssignedRole });
            db.ref(`match_rooms/${matchedRoomId}/status`).set('playing');
            enterOnlineGame(matchedRoomId, myAssignedRole);
        } else {
            // 部屋を作る
            const newRoomRef = roomsRef.push();
            currentRoomId = newRoomRef.key;
            newRoomRef.set({
                gameType: selectedGame,
                status: 'waiting',
                hostRankIndex: myRankData.index,
                board: ["", "", "", "", "", "", "", "", ""],
                currentPlayer: "X",
                winner: null,
                isDraw: false,
                players: { [myId]: { name: userData.name, role: "pending" } }
            });
            newRoomRef.onDisconnect().remove();
            enterOnlineGame(currentRoomId, "pending");
        }
    });
});

document.getElementById('cancelMatchBtn').addEventListener('click', () => {
    if (currentRoomId) db.ref(`match_rooms/${currentRoomId}`).remove();
    currentRoomId = null;
    switchScreen('modeSelectScreen');
});

// --- 6. ゲーム描画・進行処理 ---

function startLocalGame() {
    switchScreen('gameScreen');
    document.getElementById('matchTitle').textContent = currentMode === 'ai' ? "VS コンピュータ" : "近くの人と対戦";
    document.getElementById('myRoleDisplay').textContent = "ローカルプレイ中";
    
    localGameState = { board: ["", "", "", "", "", "", "", "", ""], currentPlayer: "X", winner: null, isDraw: false };
    renderBoard(localGameState);
}

function enterOnlineGame(roomId, initialRole) {
    currentRoomId = roomId;
    myRole = initialRole;
    gameListener = db.ref(`match_rooms/${roomId}`).on('value', snapshot => {
        const data = snapshot.val();
        if (!data) {
            alert("対戦相手が退出しました");
            return leaveGame();
        }
        if (data.status === 'playing') {
            switchScreen('gameScreen');
            if (myRole === "pending") myRole = data.players[myId].role;
            
            const players = Object.values(data.players);
            if (players.length >= 2) document.getElementById('matchTitle').textContent = `${players[0].name} VS ${players[1].name}`;
            
            const roleTxt = myRole === "spectator" ? "観戦中" : `プレイヤー ${myRole}`;
            document.getElementById('myRoleDisplay').textContent = `オンライン: ${roleTxt}`;
            renderBoard(data);

            // 勝敗がついた時、自分がプレイヤーならポイント付与
            if ((data.winner === myRole) && myRole !== "spectator") {
                addPoints();
            }
        }
    });
}

function renderBoard(gameState) {
    const boardElement = document.getElementById('board');
    const statusElement = document.getElementById('status');
    boardElement.innerHTML = '';

    gameState.board.forEach((cellValue, index) => {
        const cell = document.createElement('div');
        cell.className = 'cell ' + (cellValue ? cellValue.toLowerCase() : '');
        cell.textContent = cellValue;
        cell.addEventListener('click', () => handleCellClick(index, gameState));
        boardElement.appendChild(cell);
    });

    if (gameState.winner) {
        statusElement.textContent = `🎉 ${gameState.winner} の勝利！`;
    } else if (gameState.isDraw) {
        statusElement.textContent = "🤝 引き分け！";
    } else {
        const isMyTurn = (currentMode === 'local') || (myRole === gameState.currentPlayer);
        statusElement.textContent = isMyTurn ? "あなたの番です" : "相手の番です...";
    }
}

function handleCellClick(index, gameState) {
    // 観戦者、または自分の番でない（AIモード時含む）場合は弾く
    if (currentMode === 'online' && myRole !== gameState.currentPlayer) return;
    if (currentMode === 'ai' && gameState.currentPlayer !== 'X') return; 
    
    if (gameState.board[index] !== "" || gameState.winner) return;

    processMove(index, gameState);
}

function processMove(index, gameState) {
    gameState.board[index] = gameState.currentPlayer;
    
    // 勝敗チェック
    for (let p of winPatterns) {
        const [a, b, c] = p;
        if (gameState.board[a] && gameState.board[a] === gameState.board[b] && gameState.board[a] === gameState.board[c]) {
            gameState.winner = gameState.board[a];
            break;
        }
    }
    if (!gameState.winner && !gameState.board.includes("")) gameState.isDraw = true;

    gameState.currentPlayer = gameState.currentPlayer === "X" ? "O" : "X";

    if (currentMode === 'online') {
        db.ref(`match_rooms/${currentRoomId}`).update({ 
            board: gameState.board, currentPlayer: gameState.currentPlayer, winner: gameState.winner, isDraw: gameState.isDraw 
        });
    } else {
        renderBoard(gameState);
        
        // AIモードの場合、勝敗がついておらず、Oの番ならAIを動かす
        if (currentMode === 'ai' && !gameState.winner && !gameState.isDraw && gameState.currentPlayer === 'O') {
            setTimeout(() => playAI(gameState), 600); // 少し待ってから打つ
        }

        // ローカル・AIモードでのポイント付与
        if (currentMode === 'ai' && gameState.winner === 'X') addPoints();
    }
}

// ランクごとの簡易AIロジック
function playAI(gameState) {
    const emptySpots = gameState.board.map((val, idx) => val === "" ? idx : null).filter(val => val !== null);
    if (emptySpots.length === 0) return;

    const rankIndex = getRankData(userData.points[selectedGame]).index;
    let moveIndex = emptySpots[Math.floor(Math.random() * emptySpots.length)]; // 基本はランダム

    // シルバー（index >= 3）以上なら、自分が勝てる手があれば優先する
    if (rankIndex >= 3) {
        for (let idx of emptySpots) {
            gameState.board[idx] = "O";
            if (winPatterns.some(p => gameState.board[p[0]] === "O" && gameState.board[p[1]] === "O" && gameState.board[p[2]] === "O")) {
                moveIndex = idx;
            }
            gameState.board[idx] = ""; // 戻す
        }
    }
    processMove(moveIndex, gameState);
}

// 勝った時のポイント処理
function addPoints() {
    userData.points[selectedGame] += 50; // 1勝50ポイント (2勝でランクアップ)
    saveUser();
}

function leaveGame() {
    if (currentRoomId && currentMode === 'online') {
        db.ref(`match_rooms/${currentRoomId}`).off('value', gameListener);
        if (myRole !== "spectator") db.ref(`match_rooms/${currentRoomId}`).remove();
    }
    currentRoomId = null;
    currentMode = null;
    switchScreen('homeScreen');
}
document.getElementById('leaveGameBtn').addEventListener('click', leaveGame);

// --- 7. 観覧機能 ---
document.getElementById('spectateBtn').addEventListener('click', () => {
    switchScreen('spectateScreen');
    const roomList = document.getElementById('roomList');
    roomList.innerHTML = "試合データを取得中...";

    roomsRef.orderByChild('status').equalTo('playing').on('value', snapshot => {
        roomList.innerHTML = "";
        const rooms = snapshot.val();
        if (!rooms) return roomList.innerHTML = "<p>現在行われている試合はありません</p>";

        Object.keys(rooms).forEach(roomId => {
            const players = Object.values(rooms[roomId].players);
            if (players.length >= 2) {
                const title = `[${GAME_NAMES[rooms[roomId].gameType]}] ${players[0].name} vs ${players[1].name}`;
                const btn = document.createElement('div');
                btn.className = 'room-item';
                btn.textContent = `👁️ ${title}`;
                btn.addEventListener('click', () => {
                    roomsRef.off();
                    currentMode = 'online';
                    enterOnlineGame(roomId, "spectator");
                });
                roomList.appendChild(btn);
            }
        });
    });
});