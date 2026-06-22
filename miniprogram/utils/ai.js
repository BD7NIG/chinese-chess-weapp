/**
 * 中国象棋 AI 引擎
 * 基于 Minimax + Alpha-Beta 剪枝
 * 搜索深度：简单 2 层，中等 4 层
 * 
 * 依赖 chess.js 的 evaluateBoard 和 getAllMoves
 */
const chess = require('./chess')

// 走法排序分值（粗略启发式，提高剪枝效率）
function moveScore(board, move, aiColor) {
  let score = 0
  const captured = board[move.to.row][move.to.col]
  if (captured) {
    // 吃子价值：吃的子越值钱越好
    const valMap = { 'k': 1000, 'K': 1000, 'r': 600, 'R': 600, 'n': 270, 'N': 270, 'c': 285, 'C': 285, 'a': 120, 'A': 120, 'b': 120, 'B': 120, 'p': 30, 'P': 30 }
    score += valMap[captured.toLowerCase()] || 0
  }
  return score
}

/**
 * Minimax + Alpha-Beta 搜索
 * @param {Array} board - 当前棋盘
 * @param {number} depth - 剩余搜索深度
 * @param {number} alpha
 * @param {number} beta
 * @param {boolean} maximizing - 是否最大化（AI 方）
 * @param {string} aiColor - 'red' 或 'black'
 * @param {number} nodeCount - 节点计数器（用于进度反馈）
 * @returns {{ score: number, move: object|null, nodes: number }}
 */
function minimax(board, depth, alpha, beta, maximizing, aiColor, nodeCount) {
  nodeCount++
  const nodeInfo = { nodeCount }

  // 达到深度或终局
  if (depth === 0) {
    return { score: chess.evaluateBoard(board), move: null, nodeCount }
  }

  const currentColor = maximizing ? aiColor : (aiColor === 'red' ? 'black' : 'red')
  const isRedSide = currentColor === 'red'
  const moves = chess.getAllMoves(board, isRedSide)

  // 无合法走法 = 将死/困毙
  if (moves.length === 0) {
    return { score: maximizing ? -99999 + (5 - depth) : 99999 - (5 - depth), move: null, nodeCount }
  }

  // 走法排序：吃子优先
  moves.sort((a, b) => moveScore(board, b, currentColor) - moveScore(board, a, currentColor))

  let bestMove = moves[0]

  if (maximizing) {
    let maxScore = -Infinity
    for (const move of moves) {
      // 执行走棋
      const newBoard = applyMove(board, move)
      const result = minimax(newBoard, depth - 1, alpha, beta, false, aiColor, nodeCount)
      nodeCount = result.nodeCount

      if (result.score > maxScore) {
        maxScore = result.score
        bestMove = move
      }
      alpha = Math.max(alpha, result.score)
      if (beta <= alpha) break // Alpha-Beta 剪枝
    }
    return { score: maxScore, move: bestMove, nodeCount }
  } else {
    let minScore = Infinity
    for (const move of moves) {
      const newBoard = applyMove(board, move)
      const result = minimax(newBoard, depth - 1, alpha, beta, true, aiColor, nodeCount)
      nodeCount = result.nodeCount

      if (result.score < minScore) {
        minScore = result.score
        bestMove = move
      }
      beta = Math.min(beta, result.score)
      if (beta <= alpha) break
    }
    return { score: minScore, move: bestMove, nodeCount }
  }
}

/**
 * 应用走法到棋盘（返回新棋盘，不修改原棋盘）
 */
function applyMove(board, move) {
  const newBoard = board.map(r => [...r])
  newBoard[move.to.row][move.to.col] = newBoard[move.from.row][move.from.col]
  newBoard[move.from.row][move.from.col] = ''
  return newBoard
}

/**
 * AI 计算最佳走法（主入口）
 * @param {Array} board - 当前棋盘
 * @param {string} aiColor - 'red' 或 'black'
 * @param {string} level - 'easy' | 'medium'
 * @returns {{ from: {row,col}, to: {row,col} }}
 */
function getBestMove(board, aiColor, level) {
  const depth = level === 'medium' ? 3 : 2
  const result = minimax(board, depth, -Infinity, Infinity, true, aiColor, 0)
  return result.move
}

module.exports = { getBestMove }
