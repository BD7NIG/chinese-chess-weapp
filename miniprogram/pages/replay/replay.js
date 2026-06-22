const chess = require('../../utils/chess')

const PIECE_CHARS = {
  'r': '車', 'n': '馬', 'b': '象', 'a': '士', 'k': '將', 'c': '炮', 'p': '卒',
  'R': '車', 'N': '馬', 'B': '相', 'A': '士', 'K': '帥', 'C': '炮', 'P': '兵'
}

Page({
  data: {
    records: [],
    showDetail: false,
    currentStep: -1,
    totalMoves: 0,
    currentMoveDesc: '',
    stats: {
      total: 0, win: 0, lose: 0, draw: 0,
      winRate: 0, winRateClass: ''
    }
  },

  // 回放内部变量
  currentRecord: null,
  board: [],
  canvas: null,
  ctx: null,
  cellSize: 0,
  padding: 0,
  boardPixelSize: 0,

  onLoad() {
    this.loadRecords()
  },

  onShow() {
    this.loadRecords()
  },

  loadRecords() {
    let records = []
    try {
      const raw = wx.getStorageSync('chess_records')
      if (raw) records = JSON.parse(raw)
    } catch (e) {}
    if (!Array.isArray(records)) records = []

    // 计算战绩统计
    const total = records.length
    const win = records.filter(r => r.result === 'win').length
    const lose = records.filter(r => r.result === 'lose').length
    const draw = records.filter(r => r.result === 'draw').length
    const winRate = total > 0 ? Math.round(win / total * 100) : 0
    let winRateClass = 'mid'
    if (winRate >= 60) winRateClass = 'high'
    else if (winRate <= 30) winRateClass = 'low'

    this.setData({
      records,
      stats: { total, win, lose, draw, winRate, winRateClass }
    })
  },

  // ===== 选择棋谱 =====

  onSelectRecord(e) {
    const id = e.currentTarget.dataset.id
    const record = this.data.records.find(r => r.id === id)
    if (!record) return

    this.currentRecord = record
    this.board = chess.INIT_BOARD.map(r => [...r])
    this.setData({
      showDetail: true,
      currentStep: -1,
      totalMoves: record.moves.length,
      currentMoveDesc: ''
    })

    // 延迟初始化 Canvas
    setTimeout(() => this.initCanvas(), 100)
  },

  onBackToList() {
    this.setData({ showDetail: false, currentStep: -1, totalMoves: 0 })
    this.currentRecord = null
  },

  // ===== Canvas 初始化 =====

  initCanvas() {
    const query = wx.createSelectorQuery()
    query.select('#replayCanvas').fields({ node: true, size: true }).exec(res => {
      if (!res || !res[0]) return
      const canvas = res[0].node
      const ctx = canvas.getContext('2d')
      const dpr = wx.getWindowInfo().pixelRatio
      const winWidth = wx.getWindowInfo().windowWidth
      const boardSize = winWidth - Math.ceil(32 * winWidth / 750)
      this.boardPixelSize = boardSize
      canvas.width = boardSize * dpr
      canvas.height = boardSize * dpr
      ctx.scale(dpr, dpr)
      this.canvas = canvas
      this.ctx = ctx
      this.cellSize = boardSize / 9
      this.padding = this.cellSize / 2
      this.drawBoard()
    })
  },

  // ===== 棋盘绘制 =====

  drawBoard() {
    if (!this.ctx) return
    const ctx = this.ctx
    const size = this.cellSize
    const pad = this.padding
    const bSize = this.boardPixelSize
    const board = this.board

    // 背景
    ctx.fillStyle = '#e8c06f'
    ctx.fillRect(0, 0, bSize, bSize)

    // 网格线
    this.drawGrid(ctx, size, pad, bSize)

    // 楚河汉界
    ctx.fillStyle = '#5a3e1b'
    ctx.font = `bold ${size * 0.5}px "Ma Shan Zheng", "STKaiti", serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('楚  河', pad + 2 * size, pad + 4.5 * size)
    ctx.fillText('漢  界', pad + 6 * size, pad + 4.5 * size)

    // 棋子
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c]
        if (p) this.drawPiece(ctx, r, c, p, size, pad)
      }
    }

    // 当前走法高亮
    if (this.data.currentStep >= 0 && this.currentRecord) {
      const move = this.currentRecord.moves[this.data.currentStep]
      if (move) {
        const t = move.t
        // 目标位置高亮圈
        ctx.beginPath()
        ctx.arc(pad + t.col * size, pad + t.row * size, size * 0.4, 0, Math.PI * 2)
        ctx.strokeStyle = '#e94560'
        ctx.lineWidth = 3
        ctx.stroke()

        // 来源位置标记
        const f = move.f
        ctx.strokeStyle = 'rgba(233, 69, 96, 0.3)'
        ctx.lineWidth = 2
        ctx.strokeRect(pad + f.col * size - size / 2 + 2, pad + f.row * size - size / 2 + 2, size - 4, size - 4)
      }
    }
  },

  drawGrid(ctx, size, pad, bSize) {
    ctx.strokeStyle = '#5a3e1b'
    ctx.lineWidth = 1.5

    for (let r = 0; r < 10; r++) {
      ctx.beginPath()
      ctx.moveTo(pad, pad + r * size)
      ctx.lineTo(pad + 8 * size, pad + r * size)
      ctx.stroke()
    }
    for (let c = 0; c < 9; c++) {
      if (c === 0 || c === 8) {
        ctx.beginPath()
        ctx.moveTo(pad + c * size, pad)
        ctx.lineTo(pad + c * size, pad + 9 * size)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.moveTo(pad + c * size, pad)
        ctx.lineTo(pad + c * size, pad + 4 * size)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(pad + c * size, pad + 5 * size)
        ctx.lineTo(pad + c * size, pad + 9 * size)
        ctx.stroke()
      }
    }
    ctx.beginPath()
    ctx.moveTo(pad + 3 * size, pad)
    ctx.lineTo(pad + 5 * size, pad + 2 * size)
    ctx.moveTo(pad + 5 * size, pad)
    ctx.lineTo(pad + 3 * size, pad + 2 * size)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(pad + 3 * size, pad + 7 * size)
    ctx.lineTo(pad + 5 * size, pad + 9 * size)
    ctx.moveTo(pad + 5 * size, pad + 7 * size)
    ctx.lineTo(pad + 3 * size, pad + 9 * size)
    ctx.stroke()
  },

  drawPiece(ctx, row, col, piece, size, pad) {
    const x = pad + col * size
    const y = pad + row * size
    const radius = size * 0.42
    const isRed = chess.isRed(piece)
    const name = PIECE_CHARS[piece] || piece

    ctx.beginPath()
    ctx.arc(x + 3, y + 3, radius, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fill()

    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    const grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, 2, x, y, radius)
    if (isRed) {
      grad.addColorStop(0, '#f5e6c8'); grad.addColorStop(0.4, '#e8c878')
      grad.addColorStop(0.7, '#d4a840'); grad.addColorStop(1, '#b8943a')
    } else {
      grad.addColorStop(0, '#e8dcc8'); grad.addColorStop(0.4, '#c8b888')
      grad.addColorStop(0.7, '#a89058'); grad.addColorStop(1, '#907848')
    }
    ctx.fillStyle = grad; ctx.fill()

    ctx.strokeStyle = isRed ? '#8b5e1a' : '#604020'
    ctx.lineWidth = 2.5; ctx.stroke()

    ctx.beginPath()
    ctx.arc(x, y, radius * 0.78, 0, Math.PI * 2)
    ctx.strokeStyle = isRed ? 'rgba(120,60,20,0.35)' : 'rgba(60,40,20,0.35)'
    ctx.lineWidth = 1.5; ctx.stroke()

    ctx.beginPath()
    ctx.arc(x, y, radius * 0.68, 0, Math.PI * 2)
    const innerGrad = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, radius * 0.68)
    if (isRed) {
      innerGrad.addColorStop(0, '#faf0e0'); innerGrad.addColorStop(1, '#e8d4b0')
    } else {
      innerGrad.addColorStop(0, '#f0ece0'); innerGrad.addColorStop(1, '#d8ccb0')
    }
    ctx.fillStyle = innerGrad; ctx.fill()

    ctx.font = `900 ${size * 0.38}px "Ma Shan Zheng", "STKaiti", "KaiTi", serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillStyle = isRed ? 'rgba(255,220,180,0.4)' : 'rgba(240,230,210,0.4)'
    ctx.fillText(name, x + 1, y + 3)
    ctx.fillStyle = isRed ? '#8b2020' : '#1a1a1a'
    ctx.fillText(name, x, y + 2)
  },

  // ===== 走棋操作 =====

  applyMove(move) {
    const f = move.f
    const t = move.t
    this.board[t.row][t.col] = this.board[f.row][f.col]
    this.board[f.row][f.col] = ''
  },

  getMoveDesc(move, stepIndex) {
    const name = PIECE_CHARS[move.p] || move.p
    const colorText = move.c === 'red' ? '紅' : '黑'
    const capText = move.cap ? '吃' : '→'
    const chkText = move.chk ? ' 將軍！' : ''
    return `第${stepIndex + 1}手  ${colorText}${name} ${capText} (${move.f.col},${move.f.row})→(${move.t.col},${move.t.row})${chkText}`
  },

  onNext() {
    const record = this.currentRecord
    if (!record) return
    const nextStep = this.data.currentStep + 1
    if (nextStep >= record.moves.length) return

    const move = record.moves[nextStep]
    this.applyMove(move)

    this.setData({
      currentStep: nextStep,
      currentMoveDesc: this.getMoveDesc(move, nextStep)
    })
    this.drawBoard()
  },

  onPrev() {
    const record = this.currentRecord
    if (!record) return
    const prevStep = this.data.currentStep
    if (prevStep < 0) return

    // 回退：重新从初始棋盘应用到上一步
    this.board = chess.INIT_BOARD.map(r => [...r])
    const targetStep = prevStep - 1
    for (let i = 0; i <= targetStep; i++) {
      this.applyMove(record.moves[i])
    }

    this.setData({
      currentStep: targetStep,
      currentMoveDesc: targetStep >= 0 ? this.getMoveDesc(record.moves[targetStep], targetStep) : ''
    })
    this.drawBoard()
  },

  onFirst() {
    const record = this.currentRecord
    if (!record) return
    this.board = chess.INIT_BOARD.map(r => [...r])
    this.setData({
      currentStep: -1,
      currentMoveDesc: ''
    })
    this.drawBoard()
  },

  onLast() {
    const record = this.currentRecord
    if (!record) return
    this.board = chess.INIT_BOARD.map(r => [...r])
    const last = record.moves.length - 1
    for (let i = 0; i <= last; i++) {
      this.applyMove(record.moves[i])
    }
    this.setData({
      currentStep: last,
      currentMoveDesc: this.getMoveDesc(record.moves[last], last)
    })
    this.drawBoard()
  }
})
