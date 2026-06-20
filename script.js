// Firebase v10 SDKのインポート
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// ==========================================
// ⚠️ ここに自分のFirebaseプロジェクトの設定を貼り付けます
// ==========================================
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Firebaseの初期化
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const gameRef = ref(db, 'gameRoom_1'); // データベース内のパス

// DOM要素の取得
const boardElement = document.getElementById('board');
const statusElement = document.getElementById('status');
const resetBtn = document.getElementById('resetBtn');

// 初期状態の定義
const initialState = {
    board: ["", "", "", "", "", "", "", "", ""],
    currentPlayer: "X",
    winner: null,
    isDraw: false
};

// 勝利判定のパターン
const winPatterns = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // 横
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // 縦
    [0, 4, 8], [2, 4, 6]             // 斜め
];

// 盤面を描画する関数
function renderBoard(gameState) {
    boardElement.innerHTML = '';
    gameState.board.forEach((cellValue, index) => {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        if (cellValue) cell.classList.add(cellValue.toLowerCase());
        cell.textContent = cellValue;
        
        // セルがクリックされた時の処理
        cell.addEventListener('click', () => handleCellClick(index, gameState));
        boardElement.appendChild(cell);
    });

    // ステータスの更新
    if (gameState.winner) {
        statusElement.textContent = `プレイヤー ${gameState.winner} の勝利！`;
    } else if (gameState.isDraw) {
        statusElement.textContent = "引き分け！";
    } else {
        statusElement.textContent = `次は プレイヤー ${gameState.currentPlayer} の番です`;
    }
}

// セルクリック時の処理
function handleCellClick(index, gameState) {
    // 既に石が置かれている、または勝敗がついている場合は何もしない
    if (gameState.board[index] !== "" || gameState.winner) return;

    // 盤面の更新
    const newBoard = [...gameState.board];
    newBoard[index] = gameState.currentPlayer;

    // 勝敗チェック
    let newWinner = null;
    let newIsDraw = false;

    for (let pattern of winPatterns) {
        const [a, b, c] = pattern;
        if (newBoard[a] && newBoard[a] === newBoard[b] && newBoard[a] === newBoard[c]) {
            newWinner = newBoard[a];
            break;
        }
    }

    if (!newWinner && !newBoard.includes("")) {
        newIsDraw = true;
    }

    // 次のプレイヤー
    const nextPlayer = gameState.currentPlayer === "X" ? "O" : "X";

    // Firebaseに新しい状態を保存（ここで全員の画面が同期される）
    set(gameRef, {
        board: newBoard,
        currentPlayer: nextPlayer,
        winner: newWinner,
        isDraw: newIsDraw
    });
}

// データベースの変更を監視（リアルタイム同期の要）
onValue(gameRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
        renderBoard(data);
    } else {
        // データが存在しない場合は初期化
        set(gameRef, initialState);
    }
});

// リセットボタンの処理
resetBtn.addEventListener('click', () => {
    set(gameRef, initialState);
});