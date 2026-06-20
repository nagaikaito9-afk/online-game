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
const roomsRef = db.ref('rooms');

// --- 2. ユーザー管理 ---
const myId = Math.random().toString(36).substring(2, 10);
// ブラウザに名前が保存されていれば読み込み、なければゲストにする
let myName = localStorage.getItem('ticTacToeName') || "ゲスト" + Math.floor(Math.random() * 1000);
document.getElementById('userNameDisplay').textContent = myName;

// --- 3. 状態管理変数 ---
let currentRoomId = null;
let myRole = null; // "X", "O", "spectator"
let gameListener = null; // 監視解除用

// 勝敗パターン
const winPatterns = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]
];

// --- 4. 画面切り替え機能 ---
function switchScreen(screenId) {
    document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
}

// --- 5. ホーム画面のボタン操作 ---
document.getElementById('editNameBtn').addEventListener('click', () => {
    const newName = prompt("新しいユーザー名を入力してください:", myName);
    if (newName && newName.trim() !== "") {
        myName = newName.trim();
        localStorage.setItem('ticTacToeName', myName);
        document.getElementById('userNameDisplay').textContent = myName;
    }
});

// --- 6. マッチング機能 (プレイヤーとして参加) ---
document.getElementById('matchingBtn').addEventListener('click', () => {
    switchScreen('matchingScreen');

    // 待機中の部屋があるか探す
    roomsRef.orderByChild('status').equalTo('waiting').once('value', snapshot => {
        const rooms = snapshot.val();
        
        if (rooms) {
            // 【待機中の部屋があった場合】-> 参加してゲーム開始（XかOをランダムで決める）
            const roomId = Object.keys(rooms)[0];
            const roomData = rooms[roomId];
            const p1Id = Object.keys(roomData.players)[0]; // 部屋を作って待っていた人のID
            const p1Name = roomData.players[p1Id].name;

            // ランダムで役職を割り当て
            const myAssignedRole = Math.random() < 0.5 ? "X" : "O";
            const p1AssignedRole = myAssignedRole === "X" ? "O" : "X";

            // データベースを更新して試合開始状態（playing）にする
            db.ref(`rooms/${roomId}/players/${p1Id}/role`).set(p1AssignedRole);
            db.ref(`rooms/${roomId}/players/${myId}`).set({ name: myName, role: myAssignedRole });
            db.ref(`rooms/${roomId}/status`).set('playing');

            enterGame(roomId, myAssignedRole);

        } else {
            // 【待機中の部屋がない場合】-> 新しい部屋を作って相手を待つ
            const newRoomRef = roomsRef.push();
            currentRoomId = newRoomRef.key;
            newRoomRef.set({
                status: 'waiting',
                board: ["", "", "", "", "", "", "", "", ""],
                currentPlayer: "X",
                winner: null,
                isDraw: false,
                players: {
                    [myId]: { name: myName, role: "pending" } // 相手が来るまで役職は未定
                }
            });

            // もし待っている間にブラウザを閉じたら部屋を消す
            newRoomRef.onDisconnect().remove();

            // 誰かが入ってきて status が playing になるのを監視する
            enterGame(currentRoomId, "pending");
        }
    });
});

document.getElementById('cancelMatchBtn').addEventListener('click', () => {
    if (currentRoomId) db.ref(`rooms/${currentRoomId}`).remove();
    currentRoomId = null;
    switchScreen('homeScreen');
});

// --- 7. 観覧機能 ---
document.getElementById('spectateBtn').addEventListener('click', () => {
    switchScreen('spectateScreen');
    const roomList = document.getElementById('roomList');
    roomList.innerHTML = "試合データを取得中...";

    // 進行中の試合（playing）をリアルタイムで取得してボタンを作る
    roomsRef.orderByChild('status').equalTo('playing').on('value', snapshot => {
        roomList.innerHTML = "";
        const rooms = snapshot.val();
        
        if (!rooms) {
            roomList.innerHTML = "<p>現在行われている試合はありません</p>";
            return;
        }

        // 試合一覧のボタンを生成
        Object.keys(rooms).forEach(roomId => {
            const players = Object.values(rooms[roomId].players);
            if (players.length >= 2) {
                const title = `${players[0].name} vs ${players[1].name}`;
                const btn = document.createElement('div');
                btn.className = 'room-item';
                btn.textContent = `👁️ ${title} の試合を観る`;
                btn.addEventListener('click', () => {
                    roomsRef.off(); // リストの監視を解除
                    enterGame(roomId, "spectator"); // 観戦者として入室
                });
                roomList.appendChild(btn);
            }
        });
    });
});

document.getElementById('backFromSpectateBtn').addEventListener('click', () => {
    roomsRef.off();
    switchScreen('homeScreen');
});

// --- 8. ゲーム進行・描画処理 ---
function enterGame(roomId, initialRole) {
    currentRoomId = roomId;
    myRole = initialRole;
    const roomRef = db.ref(`rooms/${roomId}`);

    gameListener = roomRef.on('value', snapshot => {
        const data = snapshot.val();

        // 部屋が消えた（対戦相手が退出した）場合
        if (!data) {
            alert("この部屋は閉じられました。ホームに戻ります。");
            leaveGame();
            return;
        }

        // 相手が来て試合が始まった時の処理
        if (data.status === 'playing') {
            switchScreen('gameScreen');

            // 自分が「待ち（pending）」状態だった場合、相手が決めた役職を読み取る
            if (myRole === "pending" && data.players[myId]) {
                myRole = data.players[myId].role;
            }

            // タイトルと自分の状態の表示更新
            const players = Object.values(data.players);
            if (players.length >= 2) {
                document.getElementById('matchTitle').textContent = `${players[0].name} VS ${players[1].name}`;
            }

            const roleDisplay = document.getElementById('myRoleDisplay');
            if (myRole === "spectator") {
                roleDisplay.textContent = "あなたは【観戦者】として視聴中です";
                roleDisplay.style.color = "#95a5a6";
            } else {
                roleDisplay.textContent = `あなたは【プレイヤー ${myRole}】です`;
                roleDisplay.style.color = myRole === "X" ? "#e74c3c" : "#3498db";
            }

            // 盤面の描画
            renderBoard(data);
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
        statusElement.textContent = `🎉 プレイヤー ${gameState.winner} の勝利！`;
        statusElement.style.color = "#27ae60";
    } else if (gameState.isDraw) {
        statusElement.textContent = "🤝 引き分け！";
        statusElement.style.color = "#333";
    } else {
        if (myRole === gameState.currentPlayer) {
            statusElement.textContent = `あなたの番です！`;
            statusElement.style.color = "#e67e22";
        } else {
            statusElement.textContent = `プレイヤー ${gameState.currentPlayer} の番です...`;
            statusElement.style.color = "#7f8c8d";
        }
    }
}

function handleCellClick(index, gameState) {
    // 観戦者、または自分の番ではない場合は弾く
    if (myRole !== gameState.currentPlayer) return;
    // 既に石がある、勝敗が決まっている場合は弾く
    if (gameState.board[index] !== "" || gameState.winner) return;

    const newBoard = [...gameState.board];
    newBoard[index] = gameState.currentPlayer;

    let newWinner = null;
    let newIsDraw = false;

    for (let pattern of winPatterns) {
        const [a, b, c] = pattern;
        if (newBoard[a] && newBoard[a] === newBoard[b] && newBoard[a] === newBoard[c]) {
            newWinner = newBoard[a];
            break;
        }
    }

    if (!newWinner && !newBoard.includes("")) newIsDraw = true;
    const nextPlayer = gameState.currentPlayer === "X" ? "O" : "X";

    // データベースに一手進んだ状態を書き込む
    db.ref(`rooms/${currentRoomId}`).update({ 
        board: newBoard, currentPlayer: nextPlayer, winner: newWinner, isDraw: newIsDraw 
    });
}

// 退出処理
function leaveGame() {
    if (currentRoomId) {
        const roomRef = db.ref(`rooms/${currentRoomId}`);
        roomRef.off('value', gameListener); // 監視を解除
        
        // もし自分がプレイヤーなら、部屋ごと削除する（相手も強制退出になる）
        if (myRole === "X" || myRole === "O" || myRole === "pending") {
            roomRef.remove();
        }
    }
    currentRoomId = null;
    myRole = null;
    switchScreen('homeScreen');
}

document.getElementById('leaveGameBtn').addEventListener('click', leaveGame);