const app = getApp()
const chess = require('../../utils/chess')
const { playSound } = require('../../utils/sound')
const ai = require('../../utils/ai')

function formatTime(ms) {
  if (ms <= 0) return '00:00'
  const totalSec = Math.ceil(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

Page({
  data: {
    roomId: '',
    myColor: 'red',
    isHost: false,
    myTurn: false,
    opponentName: '等待對手...',
    myName: '我',

    // 棋钟
    myTime: '10:00',
    opponentTime: '10:00',
    myUrgent: false,
    opponentUrgent: false,

    // 棋盘
    selectedPiece: null,
    validMoves: [],
    gameOver: false,

    // 结果
    showResult: false,
    resultIcon: '🏆',
    resultTitle: '',
    resultDesc: '',
    myTimeFinal: '00:00',
    opponentTimeFinal: '00:00',

    // 开局库提示
    showOpeningTip: false,
    openingMoves: [],
    openingTipText: '',

    // 分享
    isWaiting: false
  },

  // 内部变量
  board: [],
  clockTimer: null,
  lastClockSync: null,
  lastClockTick: null,
  _pageId: '',
  moveCount: 0,          // 已走步数（用于开局库）
  _urgentPlayed: false,  // 紧迫音效已播放标记
  localMoveHistory: [],  // 本地走棋记录（用于保存棋谱）
  isAIMode: false,       // 人机模式
  aiLevel: 'easy',       // AI 难度
  aiColor: 'black',      // AI 执子颜色
  aiThinking: false,     // AI 正在思考

  onLoad(options) {
    this._pageId = 'game_' + (options.roomId || 'ai_' + Date.now())

    this.data.roomId = options.roomId || 'AI'
    this.data.myColor = options.color || 'red'
    this.data.isHost = options.isHost === 'true'
    this.data.myTurn = this.data.myColor === 'red'
    this.board = chess.INIT_BOARD.map(r => [...r])

    // AI 模式检测
    this.isAIMode = options.ai === 'true'
    this.aiLevel = options.aiLevel || 'easy'
    this.aiColor = options.aiColor || 'black'

    const timeControlMs = parseInt(options.timeControl) || 600000
    this.lastClockSync = {
      red: timeControlMs,
      black: timeControlMs
    }

    if (this.isAIMode) {
      app.globalData.pendingRoomId = null
      wx.setNavigationBarTitle({
        title: `人機對戰 (${this.aiLevel === 'easy' ? '簡單' : '中等'})`
      })
      this.data.opponentName = this.aiLevel === 'easy' ? '簡單 AI' : '中等 AI'
      this.data.isWaiting = false
    } else {
      app.globalData.pendingRoomId = options.roomId
      wx.setNavigationBarTitle({
        title: `房間 ${this.data.roomId}`
      })
    }

    this.initCanvas()
    this.startClockRenderer()

    // AI 先手：AI 执红，先走
    if (this.isAIMode && this.aiColor === 'red') {
      setTimeout(() => this.triggerAIMove(), 500)
    }

    // 人机模式下不等待
    if (!this.isAIMode) {
      this.data.isWaiting = true
    }
  },

  onShow() {
    app.registerMessageHandler(this._pageId, (msg) => this.handleGameMessage(msg))
  },

  onHide() {
    app.unregisterMessageHandler(this._pageId)
  },

  onUnload() {
    this.stopClockRenderer()
    app.unregisterMessageHandler(this._pageId)
    // 清除 pending 房间标记
    if (app.globalData.pendingRoomId === this.data.roomId) {
      app.globalData.pendingRoomId = null
    }
  },

  // ===== 游戏消息处理 =====

  handleGameMessage(msg) {
    // AI 模式忽略 WebSocket 游戏消息
    if (this.isAIMode) return

    switch (msg.type) {
      case 'opponent_joined':
        this.syncClock(msg.clock, msg.turn)
        break

      case 'opponent_move':
        // 对方走棋 — 先动画再更新棋盘
        {
          const from = msg.from
          const to = msg.to
          const piece = msg.board[to.row][to.col]
          this.moveCount++
          // 播放音效（吃子判断基于旧棋盘）
          const isCapture = this.board[to.row][to.col] !== ''
          if (isCapture) {
            playSound('capture')
          } else {
            playSound('move')
          }
          // 记录对方走棋
          this.localMoveHistory.push({
            color: this.data.myColor === 'red' ? 'black' : 'red',
            from,
            to,
            piece,
            isCapture,
            isCheck: msg.isCheck || false
          })
          this.animateMove(from, to, piece, true, () => {
            this.board = msg.board.map(r => [...r])
            this.setData({
              myTurn: true,
              selectedPiece: null,
              validMoves: []
            })
            this.syncClock(msg.clock, msg.turn)
            this.drawBoard()
            this.checkOpeningBook()

            if (msg.isCheck) {
              playSound('check')
              wx.showToast({ title: '將軍！', icon: 'none' })
            }
            if (msg.isMate) {
              this.handleGameOver(msg.winner, '將殺')
            }
          })
        }
        break

      case 'move_ack':
        this.syncClock(msg.clock, msg.turn)
        break

      case 'clock_sync':
        this.syncClock(msg.clock, msg.turn)
        break

      case 'game_over':
        this.handleGameOver(msg.winner, msg.reason || '')
        break

      case 'opponent_disconnected':
        // 对方断线，显示等待提示，但不结束对局
        wx.showModal({
          title: '提示',
          content: msg.message || '對手已斷線，等待重連...',
          showCancel: false
        })
        this.stopClockRenderer()
        this.setData({
          myTurn: false,
          selectedPiece: null,
          validMoves: [],
          resultTitle: '等待重連',
          resultDesc: '對手已斷線，將在90秒內等待重連',
          showResult: false
        })
        break

      case 'opponent_reconnected':
        // 对方重连成功
        wx.showModal({
          title: '提示',
          content: msg.message || '對手已重連，對局繼續',
          showCancel: false
        })
        this.startClockRenderer()
        break

      // ===== 悔棋 =====
      case 'undo_request':
        this.handleUndoRequest(msg.from)
        break

      case 'undo_accepted':
        // 对方同意悔棋，回退棋盘
        this.board = msg.board.map(r => [...r])
        this.setData({
          myTurn: msg.turn === this.data.myColor,
          selectedPiece: null,
          validMoves: []
        })
        this.syncClock(msg.clock, msg.turn)
        this.drawBoard()
        wx.showToast({ title: '悔棋成功', icon: 'none' })
        break

      case 'undo_rejected':
        wx.showToast({ title: msg.message || '對方拒絕悔棋', icon: 'none' })
        break

      case 'undo_sent':
        wx.showToast({ title: msg.message || '已發送悔棋請求', icon: 'none' })
        break

      // ===== 求和 =====
      case 'draw_request':
        this.handleDrawRequest(msg.from)
        break

      case 'draw_sent':
        wx.showToast({ title: msg.message || '已發送求和請求', icon: 'none' })
        break

      case 'draw_rejected':
        wx.showToast({ title: msg.message || '對方拒絕求和', icon: 'none' })
        break

      // ===== 重连 =====
      case 'reconnect_ok':
        // 重连成功，恢复棋盘状态
        this.handleReconnectOk(msg)
        break
    }
  },

  // ===== 棋钟 =====

  startClockRenderer() {
    if (this.clockTimer) return
    this.clockTimer = setInterval(() => this.renderClock(), 200)
  },

  stopClockRenderer() {
    if (this.clockTimer) {
      clearInterval(this.clockTimer)
      this.clockTimer = null
    }
  },

  syncClock(clock, turn) {
    this.lastClockSync = { red: clock.red, black: clock.black }
    this.lastClockTick = Date.now()
    this.data.myTurn = turn === this.data.myColor
    this._urgentPlayed = false  // 重置紧迫标记
    this.renderClock()
  },

  renderClock() {
    if (!this.lastClockSync) return

    let myMs = this.lastClockSync[this.data.myColor]
    let oppMs = this.data.myColor === 'red' ? this.lastClockSync.black : this.lastClockSync.red

    if (this.lastClockTick && !this.data.gameOver) {
      const elapsed = Date.now() - this.lastClockTick
      if (this.data.myTurn) {
        myMs = Math.max(0, myMs - elapsed)
      } else {
        oppMs = Math.max(0, oppMs - elapsed)
      }
    }

    const myUrgent = myMs > 0 && myMs <= 30000
    const opponentUrgent = oppMs > 0 && oppMs <= 30000

    // 自己紧迫时播放嘀嗒音效（仅一次）
    if (myMs > 0 && myMs <= 10000 && !this._urgentPlayed) {
      this._urgentPlayed = true
      playSound('urgent')
    }

    this.setData({
      myTime: formatTime(myMs),
      opponentTime: formatTime(oppMs),
      myUrgent,
      opponentUrgent
    })
  },

  // ===== 开局库 =====

  /**
   * 检查当前局面是否命开局库，更新提示
   */
  checkOpeningBook() {
    if (this.data.gameOver || !this.data.myTurn) return

    const moveCount = this.moveCount || 0
    const moves = chess.getOpeningMoves(this.board, moveCount, this.data.myColor)
    if (moves && moves.length > 0) {
      this.setData({
        showOpeningTip: true,
        openingMoves: moves,
        openingTipText: `📖 ${moves[0].name}`
      })
    } else {
      this.setData({
        showOpeningTip: false,
        openingMoves: [],
        openingTipText: ''
      })
    }
  },

  // ===== 游戏结束 =====

  handleGameOver(winner, reason) {
    this.stopClockRenderer()
    const iWin = winner === this.data.myColor
    const reasonText = reason ? `（${reason}）` : ''

    // 播放胜负音效
    if (winner === null) {
      // 和棋，不播放
    } else if (iWin) {
      playSound('win')
    } else {
      playSound('lose')
    }

    let icon, title, desc
    if (winner === null) {
      // 和棋
      icon = '🤝'
      title = '和 棋'
      desc = '雙方同意和局'
    } else if (iWin) {
      icon = '🏆'
      title = '你 贏 了 ！'
      desc = `恭喜獲勝${reasonText}`
    } else {
      icon = '😞'
      title = '你 輸 了'
      desc = `再接再厲${reasonText}`
    }

    this.setData({
      gameOver: true,
      showResult: true,
      resultIcon: icon,
      resultTitle: title,
      resultDesc: desc,
      myTimeFinal: this.data.myTime,
      opponentTimeFinal: this.data.opponentTime
    })

    // 保存棋谱到本地存储
    this.saveGameRecord(winner, reason)
  },

  saveGameRecord(winner, reason) {
    if (this.localMoveHistory.length === 0) return

    // 构建对局记录
    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      date: new Date().toLocaleString('zh-CN'),
      myColor: this.data.myColor,
      result: winner === null ? 'draw' : (winner === this.data.myColor ? 'win' : 'lose'),
      reason: reason || '',
      moveCount: this.moveCount,
      moves: this.localMoveHistory.map(m => ({
        c: m.color,
        f: m.from,
        t: m.to,
        p: m.piece,
        cap: m.isCapture ? 1 : 0,
        chk: m.isCheck ? 1 : 0
      }))
    }

    // 读取已有记录，追加
    let records = []
    try {
      const raw = wx.getStorageSync('chess_records')
      if (raw) records = JSON.parse(raw)
    } catch (e) {}
    if (!Array.isArray(records)) records = []

    records.unshift(record)
    // 最多保留 50 条
    if (records.length > 50) records = records.slice(0, 50)

    try {
      wx.setStorageSync('chess_records', JSON.stringify(records))
    } catch (e) {
      console.error('[棋谱] 保存失败:', e)
    }

    // 同步战绩到服务端
    this.syncRecordToServer(winner, reason)
  },

  syncRecordToServer(winner, reason) {
    // 仅联机对局同步（AI模式不同步）
    if (this.isAIMode) return

    const ws = app.globalData.ws
    if (!ws || !app.globalData.wsConnected) return

    const result = winner === null ? 'draw' : (winner === this.data.myColor ? 'win' : 'lose')
    const opponentName = this.data.opponentName || '未知'

    ws.send(JSON.stringify({
      type: 'sync_record',
      result,
      moveCount: this.moveCount || 0,
      myTime: this.data.myTime,
      opponentTime: this.data.opponentTime,
      reason: reason || '',
      opponentName
    }))
  },

  // ===== 重连恢复 =====

  handleReconnectOk(msg) {
    // 从服务端恢复棋盘状态
    if (msg.board) {
      this.board = msg.board.map(r => [...r])
    }

    this.data.myColor = msg.color
    this.data.myTurn = msg.turn === msg.color

    if (msg.clock) {
      this.syncClock(msg.clock, msg.turn)
    }

    this.startClockRenderer()
    this.drawBoard()

    wx.showToast({ title: '重連成功！', icon: 'none', duration: 2000 })

    console.log(`[重连] 房间 ${msg.roomId} 状态恢复: turn=${msg.turn}, myColor=${msg.color}`)
  },

  // ===== 悔棋/求和 =====

  handleUndoRequest(fromId) {
    wx.showModal({
      title: '悔棋請求',
      content: '對方請求悔棋，是否同意？',
      success: res => {
        const ws = app.globalData.ws
        if (ws) {
          ws.send(JSON.stringify({
            type: 'undo_response',
            roomId: this.data.roomId,
            accept: res.confirm
          }))
        }
      }
    })
  },

  handleDrawRequest(fromId) {
    wx.showModal({
      title: '求和請求',
      content: '對方請求求和，是否同意？',
      success: res => {
        const ws = app.globalData.ws
        if (ws) {
          ws.send(JSON.stringify({
            type: 'draw_response',
            roomId: this.data.roomId,
            accept: res.confirm
          }))
        }
        if (res.confirm) {
          this.stopClockRenderer()
          this.setData({
            gameOver: true,
            showResult: true,
            resultTitle: '和棋',
            resultDesc: '雙方同意和局'
          })
        }
      }
    })
  },

  // ===== 棋盘 Canvas =====

  initCanvas() {
    const query = wx.createSelectorQuery()
    query.select('#boardCanvas').fields({ node: true, size: true }).exec(res => {
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

  drawBoard() {
    const ctx = this.ctx
    const size = this.cellSize
    const pad = this.padding
    const bSize = this.boardPixelSize
    const board = this.board

    ctx.fillStyle = '#e8c06f'
    ctx.fillRect(0, 0, bSize, bSize)
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

    ctx.fillStyle = '#5a3e1b'
    ctx.font = `bold ${size * 0.5}px "Ma Shan Zheng", "STKaiti", serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const midY = pad + 4.5 * size
    ctx.fillText('楚  河', pad + 2 * size, midY)
    ctx.fillText('漢  界', pad + 6 * size, midY)

    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c]
        if (p) this.drawPiece(ctx, r, c, p)
      }
    }

    if (this.data.selectedPiece) {
      const { row, col } = this.data.selectedPiece
      ctx.strokeStyle = '#ff0'
      ctx.lineWidth = 3
      ctx.strokeRect(pad + col * size - size / 2 + 2, pad + row * size - size / 2 + 2, size - 4, size - 4)
    }

    for (const m of this.data.validMoves) {
      ctx.fillStyle = 'rgba(0, 255, 0, 0.4)'
      ctx.beginPath()
      ctx.arc(pad + m.col * size, pad + m.row * size, size * 0.15, 0, Math.PI * 2)
      ctx.fill()
    }

    // 绘制开局库推荐走法提示（橙色圆点）
    if (this.data.showOpeningTip && this.data.openingMoves.length > 0) {
      for (const om of this.data.openingMoves) {
        const tx = pad + om.move.to.col * size
        const ty = pad + om.move.to.row * size
        // 外圈光晕
        ctx.beginPath()
        ctx.arc(tx, ty, size * 0.25, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255, 165, 0, 0.2)'
        ctx.fill()
        // 内圈亮点
        ctx.beginPath()
        ctx.arc(tx, ty, size * 0.12, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255, 165, 0, 0.8)'
        ctx.fill()
        ctx.strokeStyle = '#ff8c00'
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }
  },

  drawPiece(ctx, row, col, piece) {
    const size = this.cellSize
    const x = this.padding + col * size
    const y = this.padding + row * size
    const radius = size * 0.42
    const isRedPiece = chess.isRed(piece)
    const name = chess.PIECE_NAMES[piece] || piece
    this.renderPiece(ctx, x, y, radius, isRedPiece, name)
  },

  // ===== 走棋动画 =====

  /**
   * 执行棋子滑动动画
   * @param {object} from - {row, col} 起点
   * @param {object} to - {row, col} 终点
   * @param {string} piece - 棋子标识
   * @param {boolean} isCapture - 是否吃子
   * @param {function} callback - 动画完成后回调
   */
  animateMove(from, to, piece, isCapture, callback) {
    const ctx = this.ctx
    const size = this.cellSize
    const pad = this.padding
    const bSize = this.boardPixelSize
    const duration = 200 // 动画时长 200ms
    const startTime = Date.now()

    const fromX = pad + from.col * size
    const fromY = pad + from.row * size
    const toX = pad + to.col * size
    const toY = pad + to.row * size

    const isRedPiece = chess.isRed(piece)
    const name = chess.PIECE_NAMES[piece] || piece
    const radius = size * 0.42

    const animate = () => {
      const elapsed = Date.now() - startTime
      const t = Math.min(elapsed / duration, 1)
      // easeOutCubic 缓动
      const ease = 1 - Math.pow(1 - t, 3)

      const x = fromX + (toX - fromX) * ease
      const y = fromY + (toY - fromY) * ease

      // 重绘棋盘背景（不含棋子）
      this.drawBoardBackground()

      // 重绘所有静止棋子（排除当前移动的棋子起点）
      const board = this.board
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
          const p = board[r][c]
          if (!p) continue
          // 移动中的棋子不画原位
          if (r === from.row && c === from.col) continue
          // 目标位置的棋子如果有（吃子），也不画 — 被吃的已被移除
          this.drawPieceAt(ctx, p, r, c)
        }
      }

      // 绘制移动中的棋子（当前帧位置）
      this.drawPieceAtXY(ctx, piece, name, isRedPiece, x, y, radius)

      // 绘制选中高亮和走法提示
      if (this.data.selectedPiece) {
        const { row, col } = this.data.selectedPiece
        ctx.strokeStyle = '#ff0'
        ctx.lineWidth = 3
        ctx.strokeRect(pad + col * size - size / 2 + 2, pad + row * size - size / 2 + 2, size - 4, size - 4)
      }
      for (const m of this.data.validMoves) {
        ctx.fillStyle = 'rgba(0, 255, 0, 0.4)'
        ctx.beginPath()
        ctx.arc(pad + m.col * size, pad + m.row * size, size * 0.15, 0, Math.PI * 2)
        ctx.fill()
      }

      if (t < 1) {
        this._animFrame = canvas.requestAnimationFrame(animate)
      } else {
        // 动画完成
        if (callback) callback()
      }
    }

    const canvas = this.canvas
    if (!canvas) {
      if (callback) callback()
      return
    }
    this._animFrame = canvas.requestAnimationFrame(animate)
  },

  /**
   * 取消正在进行的动画
   */
  cancelAnimation() {
    if (this._animFrame && this.canvas) {
      this.canvas.cancelAnimationFrame(this._animFrame)
      this._animFrame = null
    }
  },

  /** 在指定格子位置绘制棋子 */
  drawPieceAt(ctx, piece, row, col) {
    const size = this.cellSize
    const x = this.padding + col * size
    const y = this.padding + row * size
    const radius = size * 0.42
    const isRed = chess.isRed(piece)
    const name = chess.PIECE_NAMES[piece] || piece
    this.renderPiece(ctx, x, y, radius, isRed, name)
  },

  /** 在任意坐标绘制棋子 */
  drawPieceAtXY(ctx, piece, name, isRed, x, y, radius) {
    this.renderPiece(ctx, x, y, radius, isRed, name)
  },

  /** 统一的棋子渲染方法 */
  renderPiece(ctx, x, y, radius, isRedPiece, name) {
    const size = this.cellSize
    // 阴影
    ctx.beginPath()
    ctx.arc(x + 3, y + 3, radius, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fill()

    // 木纹底
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    const grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, 2, x, y, radius)
    if (isRedPiece) {
      grad.addColorStop(0, '#f5e6c8'); grad.addColorStop(0.4, '#e8c878')
      grad.addColorStop(0.7, '#d4a840'); grad.addColorStop(1, '#b8943a')
    } else {
      grad.addColorStop(0, '#e8dcc8'); grad.addColorStop(0.4, '#c8b888')
      grad.addColorStop(0.7, '#a89058'); grad.addColorStop(1, '#907848')
    }
    ctx.fillStyle = grad; ctx.fill()

    ctx.strokeStyle = isRedPiece ? '#8b5e1a' : '#604020'
    ctx.lineWidth = 2.5; ctx.stroke()

    ctx.beginPath()
    ctx.arc(x, y, radius * 0.78, 0, Math.PI * 2)
    ctx.strokeStyle = isRedPiece ? 'rgba(120,60,20,0.35)' : 'rgba(60,40,20,0.35)'
    ctx.lineWidth = 1.5; ctx.stroke()

    ctx.beginPath()
    ctx.arc(x, y, radius * 0.68, 0, Math.PI * 2)
    const innerGrad = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, radius * 0.68)
    if (isRedPiece) {
      innerGrad.addColorStop(0, '#faf0e0'); innerGrad.addColorStop(1, '#e8d4b0')
    } else {
      innerGrad.addColorStop(0, '#f0ece0'); innerGrad.addColorStop(1, '#d8ccb0')
    }
    ctx.fillStyle = innerGrad; ctx.fill()

    ctx.font = `900 ${size * 0.38}px "Ma Shan Zheng", "STKaiti", "KaiTi", serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillStyle = isRedPiece ? 'rgba(255,220,180,0.4)' : 'rgba(240,230,210,0.4)'
    ctx.fillText(name, x + 1, y + 3)
    ctx.fillStyle = isRedPiece ? '#8b2020' : '#1a1a1a'
    ctx.fillText(name, x, y + 2)
  },

  /** 仅绘制棋盘背景（线条 + 楚河汉界），不含棋子 */
  drawBoardBackground() {
    const ctx = this.ctx
    const size = this.cellSize
    const pad = this.padding
    const bSize = this.boardPixelSize

    ctx.fillStyle = '#e8c06f'
    ctx.fillRect(0, 0, bSize, bSize)
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

    ctx.fillStyle = '#5a3e1b'
    ctx.font = `bold ${size * 0.5}px "Ma Shan Zheng", "STKaiti", serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const midY = pad + 4.5 * size
    ctx.fillText('楚  河', pad + 2 * size, midY)
    ctx.fillText('漢  界', pad + 6 * size, midY)
  },

  onTouchStart(e) {
    if (this.data.gameOver) return
    const touch = e.touches[0]
    const pos = this.getBoardPos(touch.x, touch.y)
    if (!pos) return
    const { row, col } = pos
    const piece = this.board[row][col]

    // 如果点击了开局库推荐的来源棋子，自动选中并显示推荐目标
    if (!this.data.selectedPiece && this.data.showOpeningTip && this.data.openingMoves.length > 0) {
      for (const om of this.data.openingMoves) {
        if (om.move.from.row === row && om.move.from.col === col) {
          const moves = chess.getMoves(this.board, row, col)
          this.setData({ selectedPiece: { row, col }, validMoves: moves })
          this.drawBoard()
          return
        }
      }
    }

    if (this.data.myTurn) {
      if (piece && chess.isRed(piece) === (this.data.myColor === 'red')) {
        const moves = chess.getMoves(this.board, row, col)
        this.setData({ selectedPiece: { row, col }, validMoves: moves })
        this.drawBoard()
      } else if (this.data.selectedPiece) {
        this.tryMove(row, col)
      }
    }
  },

  getBoardPos(x, y) {
    const size = this.cellSize
    const pad = this.padding
    const col = Math.round((x - pad) / size)
    const row = Math.round((y - pad) / size)
    if (row < 0 || row > 9 || col < 0 || col > 8) return null
    return { row, col }
  },

  tryMove(row, col) {
    const sel = this.data.selectedPiece
    if (!sel) return
    const isValid = this.data.validMoves.some(m => m.row === row && m.col === col)
    if (!isValid) {
      this.setData({ selectedPiece: null, validMoves: [] })
      this.drawBoard()
      return
    }

    const newBoard = this.board.map(r => [...r])
    newBoard[row][col] = newBoard[sel.row][sel.col]
    newBoard[sel.row][sel.col] = ''

    const opponentColor = this.data.myColor === 'red' ? 'black' : 'red'
    const isCheck = chess.isInCheck(newBoard, opponentColor === 'red')
    const isMate = isCheck && chess.isCheckmate(newBoard, opponentColor === 'red')

    // 判断是否吃子
    const isCapture = this.board[row][col] !== ''
    // 播放音效
    if (isCapture) {
      playSound('capture')
    } else {
      playSound('move')
    }

    // 将军音效
    if (isCheck) {
      playSound('check')
    }

    this.board = newBoard
    this.moveCount++

    // 记录本地走棋
    this.localMoveHistory.push({
      color: this.data.myColor,
      from: sel,
      to: { row, col },
      piece: newBoard[row][col],
      isCapture: isCapture,
      isCheck: isCheck
    })

    this.setData({ selectedPiece: null, validMoves: [], myTurn: false })

    const ws = app.globalData.ws
    if (ws) {
      ws.send(JSON.stringify({
        type: 'move',
        roomId: this.data.roomId,
        from: sel,
        to: { row, col },
        board: newBoard,
        isCheck,
        isMate
      }))
    }

    // 执行走棋动画后再更新棋盘
    const piece = newBoard[row][col]
    this.animateMove(sel, { row, col }, piece, false, () => {
      this.drawBoard()

      // AI 模式：触发 AI 回应
      if (this.isAIMode && !this.data.gameOver) {
        this.triggerAIMove()
      }
    })
  },

  onTouchMove() {},
  onTouchEnd() {},

  // ===== 按钮 =====

  onUndo() {
    const ws = app.globalData.ws
    if (ws) ws.send(JSON.stringify({ type: 'request_undo', roomId: this.data.roomId }))
  },

  onResign() {
    wx.showModal({
      title: '認輸',
      content: '確定要認輸嗎？',
      success: res => {
        if (res.confirm) {
          const ws = app.globalData.ws
          ws.send(JSON.stringify({ type: 'resign', roomId: this.data.roomId }))
          this.stopClockRenderer()
          this.setData({
            gameOver: true,
            showResult: true,
            resultIcon: '😞',
            resultTitle: '你認輸了',
            resultDesc: '下次再加油！',
            myTimeFinal: this.data.myTime,
            opponentTimeFinal: this.data.opponentTime
          })
        }
      }
    })
  },

  onDraw() {
    const ws = app.globalData.ws
    if (ws) {
      ws.send(JSON.stringify({ type: 'request_draw', roomId: this.data.roomId }))
      wx.showToast({ title: '已發送求和請求', icon: 'none' })
    }
  },

  onBackHome() {
    wx.navigateBack()
  },

  // ===== AI 走棋 =====

  /**
   * 触发 AI 走棋（异步计算，延迟动画）
   */
  triggerAIMove() {
    if (this.aiThinking || this.data.gameOver) return

    // AI 不需要计时
    this.stopClockRenderer()

    this.aiThinking = true
    this.setData({
      myTurn: false,
      selectedPiece: null,
      validMoves: [],
      openingTipText: '🤖 AI 思考中...',
      showOpeningTip: true
    })

    // 异步计算：setTimeout 让 UI 能刷新
    setTimeout(() => {
      try {
        const move = ai.getBestMove(this.board, this.aiColor, this.aiLevel)
        if (!move) {
          this.aiThinking = false
          this.setData({
            showOpeningTip: false,
            openingTipText: ''
          })
          return
        }

        // 执行 AI 走棋
        const newBoard = this.board.map(r => [...r])
        const captured = newBoard[move.to.row][move.to.col] !== ''
        newBoard[move.to.row][move.to.col] = newBoard[move.from.row][move.from.col]
        newBoard[move.from.row][move.from.col] = ''

        // 判断将军
        const playerColor = this.data.myColor
        const isCheck = chess.isInCheck(newBoard, playerColor === 'red')
        const isMate = isCheck && chess.isCheckmate(newBoard, playerColor === 'red')

        // 播放音效
        if (captured) {
          playSound('capture')
        } else {
          playSound('move')
        }
        if (isCheck) {
          playSound('check')
        }

        // 记录
        this.moveCount++
        this.localMoveHistory.push({
          color: this.aiColor,
          from: move.from,
          to: move.to,
          piece: newBoard[move.to.row][move.to.col],
          isCapture: captured,
          isCheck
        })

        // 动画展示 AI 走棋
        const piece = newBoard[move.to.row][move.to.col]
        this.animateMove(move.from, move.to, piece, captured, () => {
          this.board = newBoard
          this.aiThinking = false

          if (isMate) {
            this.handleGameOver(playerColor, '將殺')
            return
          }

          // 恢复玩家回合
          this.data.myTurn = true
          this.setData({
            myTurn: true,
            showOpeningTip: false,
            openingTipText: ''
          })
          this.startClockRenderer()
          this.drawBoard()
          this.checkOpeningBook()
        })
      } catch (e) {
        console.error('[AI] 计算错误:', e)
        this.aiThinking = false
        this.setData({
          showOpeningTip: false,
          openingTipText: ''
        })
      }
    }, 300) // 300ms 延迟，模拟思考
  },

  // ===== 分享 =====

  /**
   * 点击邀请好友按钮：复制房间号并提示转发
   */
  onShareRoom() {
    const roomId = this.data.roomId
    wx.setClipboardData({
      data: roomId,
      success: () => {
        wx.showModal({
          title: '房間號已複製',
          content: `房間號: ${roomId}\n\n已複製到剪貼板，請發送給好友。\n好友在首頁點「加入房間」輸入此號碼即可。`,
          showCancel: true,
          cancelText: '關閉',
          confirmText: '轉發給好友',
          success: res => {
            if (res.confirm) {
              // 触发微信原生转发
              wx.shareAppMessage ? wx.shareAppMessage() : null
            }
          }
        })
      }
    })
  },

  /**
   * 微信原生转发设置
   */
  onShareAppMessage() {
    const roomId = this.data.roomId
    return {
      title: `♟ 来下一盘中国象棋！房间号: ${roomId}`,
      path: `/pages/index/index`,
      imageUrl: '/images/share-cover.png'
    }
  }
})
