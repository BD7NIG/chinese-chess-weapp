/**
 * 中国象棋规则引擎
 * 棋盘: 10行 x 9列 (row: 0-9, col: 0-8)
 * 红方在下 (row 5-9)，黑方在上 (row 0-4)
 * 棋子: R=红车, N=红马, B=红相, A=红士, K=红帅, C=红炮, P=红兵
 *       r=黑车, n=黑马, b=黑象, a=黑士, k=黑将, c=黑炮, p=黑卒
 */

// 初始棋盘布局
const INIT_BOARD = [
  ['r', 'n', 'b', 'a', 'k', 'a', 'b', 'n', 'r'],
  ['',  '',  '',  '',  '',  '',  '',  '',  ''],
  ['',  'c', '',  '',  '',  '',  '',  'c', ''],
  ['p', '',  'p', '',  'p', '',  'p', '',  'p'],
  ['',  '',  '',  '',  '',  '',  '',  '',  ''],
  ['',  '',  '',  '',  '',  '',  '',  '',  ''],
  ['P', '',  'P', '',  'P', '',  'P', '',  'P'],
  ['',  'C', '',  '',  '',  '',  '',  'C', ''],
  ['',  '',  '',  '',  '',  '',  '',  '',  ''],
  ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'],
]

// 棋子中文名
const PIECE_NAMES = {
  'r': '車', 'n': '馬', 'b': '象', 'a': '士', 'k': '將', 'c': '炮', 'p': '卒',
  'R': '車', 'N': '馬', 'B': '相', 'A': '士', 'K': '帥', 'C': '炮', 'P': '兵'
}

function isRed(piece) {
  return piece && piece === piece.toUpperCase()
}

function isBlack(piece) {
  return piece && piece === piece.toLowerCase()
}

function sameColor(a, b) {
  return (isRed(a) && isRed(b)) || (isBlack(a) && isBlack(b))
}

function inBoard(row, col) {
  return row >= 0 && row <= 9 && col >= 0 && col <= 8
}

function inPalace(row, col, isRedSide) {
  if (col < 3 || col > 5) return false
  return isRedSide ? (row >= 7 && row <= 9) : (row >= 0 && row <= 2)
}

function inOwnHalf(row, isRedSide) {
  return isRedSide ? (row >= 5) : (row <= 4)
}

/**
 * 获取某棋子所有合法走法
 */
function getMoves(board, row, col) {
  const piece = board[row][col]
  if (!piece) return []

  const moves = []
  const red = isRed(piece)
  const type = piece.toLowerCase()

  switch (type) {
    case 'k': // 将/帅
      getKingMoves(board, row, col, red, moves)
      break
    case 'a': // 士
      getAdvisorMoves(board, row, col, red, moves)
      break
    case 'b': // 相/象
      getBishopMoves(board, row, col, red, moves)
      break
    case 'n': // 马
      getKnightMoves(board, row, col, red, moves)
      break
    case 'r': // 车
      getRookMoves(board, row, col, red, moves)
      break
    case 'c': // 炮
      getCannonMoves(board, row, col, red, moves)
      break
    case 'p': // 兵/卒
      getPawnMoves(board, row, col, red, moves)
      break
  }

  // 过滤：走完后不能将自己的将/帅暴露在对方攻击下
  return moves.filter(m => {
    const testBoard = board.map(r => [...r])
    testBoard[m.row][m.col] = testBoard[row][col]
    testBoard[row][col] = ''
    return !isInCheck(testBoard, red)
  })
}

function getKingMoves(board, row, col, red, moves) {
  const dirs = [[-1,0],[1,0],[0,-1],[0,1]]
  for (const [dr, dc] of dirs) {
    const nr = row + dr, nc = col + dc
    if (!inPalace(nr, nc, red)) continue
    const target = board[nr][nc]
    if (!target || !sameColor(target, board[row][col])) {
      moves.push({ row: nr, col: nc })
    }
  }
  // 将帅对面（飞将）
  const oppKing = red ? 'k' : 'K'
  const oppRow = red ? 0 : 9
  if (col === 3 || col === 4 || col === 5) {
    let blocked = false
    const step = red ? -1 : 1
    for (let r = row + step; r >= 0 && r <= 9; r += step) {
      if (board[r][col] === oppKing) {
        if (!blocked) moves.push({ row: r, col })
        break
      }
      if (board[r][col]) blocked = true
    }
  }
}

function getAdvisorMoves(board, row, col, red, moves) {
  const dirs = [[-1,-1],[-1,1],[1,-1],[1,1]]
  for (const [dr, dc] of dirs) {
    const nr = row + dr, nc = col + dc
    if (!inPalace(nr, nc, red)) continue
    const target = board[nr][nc]
    if (!target || !sameColor(target, board[row][col])) {
      moves.push({ row: nr, col: nc })
    }
  }
}

function getBishopMoves(board, row, col, red, moves) {
  const dirs = [[-2,-2],[-2,2],[2,-2],[2,2]]
  for (const [dr, dc] of dirs) {
    const nr = row + dr, nc = col + dc
    if (!inBoard(nr, nc)) continue
    if (!inOwnHalf(nr, red)) continue // 相不过河
    const blockR = row + dr / 2, blockC = col + dc / 2
    if (board[blockR][blockC]) continue // 塞象眼
    const target = board[nr][nc]
    if (!target || !sameColor(target, board[row][col])) {
      moves.push({ row: nr, col: nc })
    }
  }
}

function getKnightMoves(board, row, col, red, moves) {
  const jumps = [
    [-2,-1], [-2,1], [-1,-2], [-1,2],
    [1,-2], [1,2], [2,-1], [2,1]
  ]
  const legs = [
    [-1,0], [-1,0], [0,-1], [0,1],
    [0,-1], [0,1], [1,0], [1,0]
  ]
  for (let i = 0; i < 8; i++) {
    const nr = row + jumps[i][0], nc = col + jumps[i][1]
    if (!inBoard(nr, nc)) continue
    const lr = row + legs[i][0], lc = col + legs[i][1]
    if (board[lr][lc]) continue // 蹩马腿
    const target = board[nr][nc]
    if (!target || !sameColor(target, board[row][col])) {
      moves.push({ row: nr, col: nc })
    }
  }
}

function getRookMoves(board, row, col, red, moves) {
  const dirs = [[-1,0],[1,0],[0,-1],[0,1]]
  for (const [dr, dc] of dirs) {
    let nr = row + dr, nc = col + dc
    while (inBoard(nr, nc)) {
      const target = board[nr][nc]
      if (!target) {
        moves.push({ row: nr, col: nc })
      } else {
        if (!sameColor(target, board[row][col])) {
          moves.push({ row: nr, col: nc })
        }
        break
      }
      nr += dr
      nc += dc
    }
  }
}

function getCannonMoves(board, row, col, red, moves) {
  const dirs = [[-1,0],[1,0],[0,-1],[0,1]]
  for (const [dr, dc] of dirs) {
    let nr = row + dr, nc = col + dc
    let jumped = false
    while (inBoard(nr, nc)) {
      const target = board[nr][nc]
      if (!jumped) {
        if (!target) {
          moves.push({ row: nr, col: nc })
        } else {
          jumped = true
        }
      } else {
        if (target) {
          if (!sameColor(target, board[row][col])) {
            moves.push({ row: nr, col: nc })
          }
          break
        }
      }
      nr += dr
      nc += dc
    }
  }
}

function getPawnMoves(board, row, col, red, moves) {
  const forward = red ? -1 : 1
  const crossed = !inOwnHalf(row, red)

  // 向前
  const nr = row + forward
  if (inBoard(nr, col)) {
    const target = board[nr][col]
    if (!target || !sameColor(target, board[row][col])) {
      moves.push({ row: nr, col })
    }
  }

  // 过河后可左右
  if (crossed) {
    for (const dc of [-1, 1]) {
      const nc = col + dc
      if (inBoard(row, nc)) {
        const target = board[row][nc]
        if (!target || !sameColor(target, board[row][col])) {
          moves.push({ row, col: nc })
        }
      }
    }
  }
}

/**
 * 判断某方是否被将军
 */
function isInCheck(board, redSide) {
  const king = redSide ? 'K' : 'k'
  let kingRow = -1, kingCol = -1
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] === king) {
        kingRow = r
        kingCol = c
        break
      }
    }
    if (kingRow >= 0) break
  }

  // 检查对方所有棋子是否能攻击到将/帅
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c]
      if (!p || sameColor(p, king)) continue
      const moves = getRawMoves(board, r, c)
      if (moves.some(m => m.row === kingRow && m.col === kingCol)) {
        return true
      }
    }
  }
  return false
}

/**
 * 判断是否将杀（将死）
 */
function isCheckmate(board, redSide) {
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c]
      if (!p || !sameColor(p, redSide ? 'R' : 'r')) continue
      if (getMoves(board, r, c).length > 0) return false
    }
  }
  return true
}

/**
 * 原始走法（不检测将军过滤）
 */
function getRawMoves(board, row, col) {
  const piece = board[row][col]
  if (!piece) return []
  const moves = []
  const red = isRed(piece)
  const type = piece.toLowerCase()
  switch (type) {
    case 'k': getKingMoves(board, row, col, red, moves); break
    case 'a': getAdvisorMoves(board, row, col, red, moves); break
    case 'b': getBishopMoves(board, row, col, red, moves); break
    case 'n': getKnightMoves(board, row, col, red, moves); break
    case 'r': getRookMoves(board, row, col, red, moves); break
    case 'c': getCannonMoves(board, row, col, red, moves); break
    case 'p': getPawnMoves(board, row, col, red, moves); break
  }
  return moves
}

// ====== 开局库 ======

/**
 * 将棋盘序列化为紧凑字符串键
 */
function boardToKey(board) {
  return board.map(r => r.map(c => c || '.').join('')).join('/')
}

/**
 * 实战开局库
 * 键：当前棋盘局面 → 推荐走法
 * 每个推荐: { move: { from: {row,col}, to: {row,col} }, name: '布局名', comment: '提示' }
 * 只覆盖经典开局前几步
 */
const OPENING_BOOK = {
  // 初始局面 → 红方几种常见开局
  'rnbakabnr/........./.c.....c./p.p.p.p.p/........./........./P.P.P.P.P/.C...C.../........./RNBAKABNR': [
    { move: { from: { row: 7, col: 1 }, to: { row: 7, col: 4 } }, name: '中炮', comment: '中炮開局，攻擊中路' },
    { move: { from: { row: 6, col: 6 }, to: { row: 5, col: 6 } }, name: '仙人指路', comment: '仙人指路，靈活多變' },
    { move: { from: { row: 9, col: 2 }, to: { row: 7, col: 4 } }, name: '飛相局', comment: '飛相局，穩健防守' },
    { move: { from: { row: 9, col: 1 }, to: { row: 7, col: 2 } }, name: '起馬局', comment: '起馬局，均衡發展' }
  ]
}

/**
 * 查找开局库
 * @param {Array} board - 当前棋盘
 * @param {number} moveCount - 已走步数
 * @param {string} myColor - 'red' | 'black'
 * @returns {Array|null} 推荐走法数组，或 null
 */
function getOpeningMoves(board, moveCount, myColor) {
  if (moveCount > 4) return null // 只在前 4 步提示

  const key = boardToKey(board)
  const moves = OPENING_BOOK[key]
  if (!moves || moves.length === 0) return null

  // 过滤出属于当前方的走法（红方走大写字母开头的，黑方走小写）
  return moves.filter(m => {
    const piece = board[m.move.from.row][m.move.from.col]
    if (!piece) return false
    const isRedPiece = piece === piece.toUpperCase()
    return (myColor === 'red' && isRedPiece) || (myColor === 'black' && !isRedPiece)
  })
}

// ====== 局面评估函数 ======

// 棋子基础价值
const PIECE_VALUES = {
  'k': 10000, 'K': 10000,  // 将/帅
  'a': 120, 'A': 120,      // 士
  'b': 120, 'B': 120,      // 象/相
  'n': 270, 'N': 270,      // 马
  'r': 600, 'R': 600,      // 车
  'c': 285, 'C': 285,      // 炮
  'p': 30, 'P': 30         // 兵/卒
}

/**
 * 评估当前局面（红方为正，黑方为负）
 */
function evaluateBoard(board) {
  let score = 0
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c]
      if (!p) continue
      let val = PIECE_VALUES[p.toLowerCase()] || 0
      // 过河兵价值提升
      if (p.toLowerCase() === 'p') {
        const crossed = p === p.toUpperCase() ? (r <= 4) : (r >= 5)
        if (crossed) val = Math.round(val * 1.5)
      }
      if (p === p.toUpperCase()) {
        score += val  // 红方正
      } else {
        score -= val  // 黑方负
      }
    }
  }
  return score
}

/**
 * 获取某方所有合法走法
 */
function getAllMoves(board, redSide) {
  const allMoves = []
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c]
      if (!p) continue
      const isRed = p === p.toUpperCase()
      if (isRed !== redSide) continue
      const moves = getMoves(board, r, c)
      for (const m of moves) {
        allMoves.push({ from: { row: r, col: c }, to: m })
      }
    }
  }
  return allMoves
}

module.exports = {
  INIT_BOARD,
  PIECE_NAMES,
  isRed,
  isBlack,
  inBoard,
  getMoves,
  isInCheck,
  isCheckmate,
  getOpeningMoves,
  evaluateBoard,
  getAllMoves
}
