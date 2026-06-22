const WebSocket = require('ws')
const { v4: uuidv4 } = require('uuid')
const http = require('http')

const PORT = process.env.PORT || 3000
const wss = new WebSocket.Server({ port: PORT })

// ====== 用户账号系统（服务端内存存储） ======
// openid 是微信用户的唯一标识。目前用设备ID模拟，未来可改为真实 wx.login
// users: Map<openid, { nickname, avatar, total, win, lose, draw, recentRecords[] }>
const users = new Map()

// openid 到 playerId 的映射（快速查找在线玩家的绑定关系）
const openidToPlayerId = new Map()

// 每方默认对局时长（毫秒）
const DEFAULT_TIME_MS = 10 * 60 * 1000 // 10分钟

// 房间管理 Map<roomId, Room>
// Room = { id, players, board, status, redPlayer, blackPlayer, turn,
//          clock: { red, black, timer }, timeControl, moveHistory, undoPending,
//          reconnectTimer, disconnectedAt, disconnectedPlayer }
// status: 'waiting' | 'playing' | 'paused' | 'finished'
const rooms = new Map()
// 匹配队列
const matchQueue = []
// 玩家连接 Map<playerId, { ws, playerId, roomId }>
const players = new Map()

// ====== 棋钟工具函数 ======

function initClock(timeControlMs) {
  return {
    red: timeControlMs,
    black: timeControlMs,
    timer: null,
    lastTick: null
  }
}

function startClock(room) {
  if (room.clock.timer) return
  room.clock.lastTick = Date.now()
  room.clock.timer = setInterval(() => {
    tickClock(room)
  }, 200) // 200ms 精度，足够平滑
}

function stopClock(room) {
  if (room.clock.timer) {
    clearInterval(room.clock.timer)
    room.clock.timer = null
  }
}

function tickClock(room) {
  if (!room.clock.lastTick) return
  const now = Date.now()
  const elapsed = now - room.clock.lastTick
  room.clock.lastTick = now

  const side = room.turn // 'red' 或 'black'
  room.clock[side] -= elapsed

  // 超时检测
  if (room.clock[side] <= 0) {
    room.clock[side] = 0
    stopClock(room)
    room.status = 'finished'

    const winner = side === 'red' ? 'black' : 'red'
    broadcast(room, {
      type: 'game_over',
      winner,
      reason: '超时',
      clock: { red: room.clock.red, black: room.clock.black }
    })
    console.log(`[超时] 房间 ${room.id}: ${side}方超时，${winner}方获胜`)
    return
  }

  // 每秒广播一次时间同步（每5个tick约1秒）
  if (elapsed > 0 && Math.floor(now / 1000) !== Math.floor((now - elapsed) / 1000)) {
    broadcast(room, {
      type: 'clock_sync',
      clock: { red: room.clock.red, black: room.clock.black },
      turn: room.turn
    })
  }
}

function switchClock(room) {
  // 重置 lastTick，记时从当前方开始
  room.clock.lastTick = Date.now()
}

// ====== WebSocket 处理 ======

wss.on('connection', (ws) => {
  const playerId = uuidv4().slice(0, 8)
  const info = { ws, playerId, roomId: null }
  players.set(playerId, info)

  console.log(`[连接] 玩家 ${playerId} 加入，当前在线: ${players.size}`)

  ws.send(JSON.stringify({ type: 'connected', playerId }))

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data)
      handleMessage(playerId, msg)
    } catch (e) {
      console.error('[错误] 消息解析失败:', e.message)
    }
  })

  ws.on('close', () => {
    console.log(`[断开] 玩家 ${playerId} 离开`)
    handleDisconnect(playerId)
    players.delete(playerId)
  })
})

function handleMessage(playerId, msg) {
  const player = players.get(playerId)
  if (!player) return

  switch (msg.type) {
    case 'match':
      handleMatch(playerId)
      break
    case 'create_room':
      handleCreateRoom(playerId)
      break
    case 'join_room':
      handleJoinRoom(playerId, msg.roomId)
      break
    case 'move':
      handleMove(playerId, msg)
      break
    case 'request_undo':
      handleRequestUndo(playerId, msg)
      break
    case 'undo_response':
      handleUndoResponse(playerId, msg)
      break
    case 'request_draw':
      handleDraw(playerId, msg)
      break
    case 'draw_response':
      handleDrawResponse(playerId, msg)
      break
    case 'resign':
      handleResign(playerId, msg)
      break
    case 'reconnect':
      handleReconnect(playerId, msg)
      break
    case 'login':
      handleLogin(playerId, msg)
      break
    case 'sync_record':
      handleSyncRecord(playerId, msg)
      break
    case 'get_stats':
      handleGetStats(playerId, msg)
      break
    default:
      sendTo(playerId, { type: 'error', message: '未知消息类型' })
  }
}

function handleMatch(playerId) {
  if (matchQueue.length > 0) {
    // 有等待的玩家，配对
    const opponentId = matchQueue.shift()
    const opponent = players.get(opponentId)
    if (!opponent) {
      // 对手已离线，重新入队
      matchQueue.push(playerId)
      return
    }

    const roomId = uuidv4().slice(0, 6).toUpperCase()
    const room = {
      id: roomId,
      players: new Map(),
      board: null,
      status: 'playing',
      redPlayer: opponentId,
      blackPlayer: playerId,
      turn: 'red',
      clock: initClock(DEFAULT_TIME_MS),
      timeControl: DEFAULT_TIME_MS,
      moveHistory: [],
      undoPending: null
    }
    room.players.set(opponentId, 'red')
    room.players.set(playerId, 'black')
    rooms.set(roomId, room)

    const player = players.get(playerId)
    const opponentInfo = players.get(opponentId)
    player.roomId = roomId
    opponentInfo.roomId = roomId

    sendTo(opponentId, { type: 'matched', roomId, color: 'red', timeControl: DEFAULT_TIME_MS })
    sendTo(playerId, { type: 'matched', roomId, color: 'black', timeControl: DEFAULT_TIME_MS })

    // 开始红方计时
    startClock(room)

    console.log(`[匹配] 房间 ${roomId}: ${opponentId}(红) vs ${playerId}(黑)`)
  } else {
    matchQueue.push(playerId)
    sendTo(playerId, { type: 'waiting', message: '正在匹配對手...' })
    console.log(`[匹配] ${playerId} 进入匹配队列`)
  }
}

function handleCreateRoom(playerId) {
  const roomId = uuidv4().slice(0, 6).toUpperCase()
    const room = {
      id: roomId,
      players: new Map(),
      board: null,
      status: 'waiting',
      redPlayer: playerId,
      blackPlayer: null,
      turn: 'red',
      clock: initClock(DEFAULT_TIME_MS),
      timeControl: DEFAULT_TIME_MS,
      moveHistory: [],
      undoPending: null
    }
  room.players.set(playerId, 'red')
  rooms.set(roomId, room)

  const player = players.get(playerId)
  player.roomId = roomId

  sendTo(playerId, { type: 'room_created', roomId, color: 'red', timeControl: DEFAULT_TIME_MS })
  console.log(`[房间] ${playerId} 创建房间 ${roomId}`)
}

function handleJoinRoom(playerId, roomId) {
  const room = rooms.get(roomId)
  if (!room) {
    sendTo(playerId, { type: 'error', message: '房間不存在' })
    return
  }
  if (room.status !== 'waiting') {
    sendTo(playerId, { type: 'error', message: '房間已滿或已開始' })
    return
  }

  room.blackPlayer = playerId
  room.players.set(playerId, 'black')
  room.status = 'playing'

  const player = players.get(playerId)
  player.roomId = roomId

  sendTo(playerId, {
    type: 'joined',
    roomId,
    color: 'black',
    timeControl: room.timeControl
  })
  sendTo(room.redPlayer, {
    type: 'opponent_joined',
    opponentId: playerId,
    clock: room.clock,
    turn: room.turn
  })

  // 双方就绪，开始红方计时
  startClock(room)

  console.log(`[房间] ${playerId} 加入房间 ${roomId}`)
}

function handleMove(playerId, msg) {
  const player = players.get(playerId)
  if (!player || !player.roomId) return

  const room = rooms.get(player.roomId)
  if (!room || room.status !== 'playing') return

  const color = room.players.get(playerId)
  if (color !== room.turn) {
    sendTo(playerId, { type: 'error', message: '還沒輪到你走棋' })
    return
  }

  // 切换回合
  room.turn = room.turn === 'red' ? 'black' : 'red'
  switchClock(room)

  // 记录棋谱
  const moveRecord = {
    color,
    from: msg.from,
    to: msg.to,
    board: msg.board.map(r => [...r]),
    turn: room.turn,
    clock: { red: room.clock.red, black: room.clock.black }
  }
  room.moveHistory.push(moveRecord)

  // 广播走棋信息给房间内所有玩家
  const opponentId = color === 'red' ? room.blackPlayer : room.redPlayer

  sendTo(playerId, {
    type: 'move_ack',
    from: msg.from,
    to: msg.to,
    board: msg.board,
    isCheck: msg.isCheck,
    isMate: msg.isMate,
    turn: room.turn,
    clock: room.clock
  })

  if (opponentId) {
    sendTo(opponentId, {
      type: 'opponent_move',
      from: msg.from,
      to: msg.to,
      board: msg.board,
      isCheck: msg.isCheck,
      isMate: msg.isMate,
      turn: room.turn,
      clock: room.clock
    })
  }

  if (msg.isMate) {
    room.status = 'finished'
    stopClock(room)
    broadcast(room, { type: 'game_over', winner: color, reason: '将杀', clock: room.clock })
  }
}

function handleRequestUndo(playerId, msg) {
  const player = players.get(playerId)
  if (!player || !player.roomId) return
  const room = rooms.get(player.roomId)
  if (!room || room.status !== 'playing') return

  // 不能连续悔棋
  if (room.undoPending) {
    sendTo(playerId, { type: 'error', message: '已有悔棋請求待處理' })
    return
  }

  // 没有走棋记录不能悔棋
  if (room.moveHistory.length < 1) {
    sendTo(playerId, { type: 'error', message: '沒有可悔的棋' })
    return
  }

  room.undoPending = {
    requester: playerId,
    moveCount: 1
  }

  const opponentId = room.players.get(playerId) === 'red' ? room.blackPlayer : room.redPlayer
  if (opponentId) {
    sendTo(opponentId, { type: 'undo_request', from: playerId })
    sendTo(playerId, { type: 'undo_sent', message: '已發送悔棋請求，等待對方回應...' })
  }
}

function handleUndoResponse(playerId, msg) {
  const player = players.get(playerId)
  if (!player || !player.roomId) return
  const room = rooms.get(player.roomId)
  if (!room || room.status !== 'playing') return

  const requester = room.undoPending ? room.undoPending.requester : null
  if (!requester) return

  // 只有对方可以回应
  const isOpponent = room.players.get(playerId) !== room.players.get(requester)
  if (!isOpponent) return

  const accepted = msg.accept === true

  if (accepted) {
    // 执行悔棋：回退一步
    const lastMove = room.moveHistory.pop()
    if (lastMove) {
      room.turn = lastMove.color // 回到走棋方的回合
      // 回退时钟到走棋前
      if (lastMove.clock) {
        room.clock.red = lastMove.clock.red
        room.clock.black = lastMove.clock.black
      }
      room.clock.lastTick = Date.now()

      // 通知双方
      broadcast(room, {
        type: 'undo_accepted',
        board: lastMove.board,
        turn: room.turn,
        clock: room.clock,
        from: lastMove.from,
        to: lastMove.to
      })
    }
  } else {
    sendTo(requester, { type: 'undo_rejected', message: '對方拒絕了悔棋請求' })
  }

  room.undoPending = null
}

function handleDraw(playerId, msg) {
  const player = players.get(playerId)
  if (!player || !player.roomId) return
  const room = rooms.get(player.roomId)
  if (!room || room.status !== 'playing') return

  const opponentId = room.players.get(playerId) === 'red' ? room.blackPlayer : room.redPlayer
  if (opponentId) {
    sendTo(opponentId, { type: 'draw_request', from: playerId })
    sendTo(playerId, { type: 'draw_sent', message: '已發送求和請求，等待對方回應...' })
  }
}

function handleDrawResponse(playerId, msg) {
  const player = players.get(playerId)
  if (!player || !player.roomId) return
  const room = rooms.get(player.roomId)
  if (!room || room.status !== 'playing') return

  // 找到请求方
  const requester = room.players.get(playerId) === 'red' ? room.blackPlayer : room.redPlayer
  const accepted = msg.accept === true

  if (accepted) {
    room.status = 'finished'
    stopClock(room)
    broadcast(room, {
      type: 'game_over',
      winner: null,
      reason: '和棋',
      clock: room.clock
    })
  } else {
    sendTo(requester, { type: 'draw_rejected', message: '對方拒絕了求和請求' })
  }
}

function handleResign(playerId, msg) {
  const player = players.get(playerId)
  if (!player || !player.roomId) return
  const room = rooms.get(player.roomId)
  if (!room) return

  room.status = 'finished'
  stopClock(room)
  const color = room.players.get(playerId)
  const winner = color === 'red' ? 'black' : 'red'
  broadcast(room, { type: 'game_over', winner, reason: '認輸', clock: room.clock })
}

const RECONNECT_TIMEOUT_MS = 90000 // 90秒重连等待

function handleDisconnect(playerId) {
  // 从匹配队列移除
  const idx = matchQueue.indexOf(playerId)
  if (idx >= 0) matchQueue.splice(idx, 1)

  // 处理房间
  const player = players.get(playerId)
  if (player && player.roomId) {
    const room = rooms.get(player.roomId)
    if (room && (room.status === 'playing' || room.status === 'paused')) {
      // 停止棋钟，标记断线
      stopClock(room)
      room.status = 'paused'
      room.disconnectedAt = Date.now()
      room.disconnectedPlayer = playerId

      // 通知对手对方断线
      const opponentId = playerId === room.redPlayer ? room.blackPlayer : room.redPlayer
      if (opponentId) {
        sendTo(opponentId, {
          type: 'opponent_disconnected',
          message: '對手已斷線，等待重連...',
          reconnectTimeout: RECONNECT_TIMEOUT_MS
        })
      }

      // 启动重连倒计时
      room.reconnectTimer = setTimeout(() => {
        // 超时仍未重连，判断线方负
        if (room.status === 'paused' || room.status === 'playing') {
          room.status = 'finished'
          stopClock(room)
          const color = room.players.get(playerId)
          const winner = color === 'red' ? 'black' : 'red'
          broadcast(room, {
            type: 'game_over',
            winner,
            reason: '超時未重連',
            clock: { red: room.clock.red, black: room.clock.black }
          })
          console.log(`[断线] 房间 ${room.id}: ${playerId} 超时未重连，${winner}方获胜`)
        }
        // 清理房间
        cleanupRoom(room)
      }, RECONNECT_TIMEOUT_MS)

      console.log(`[断线] 玩家 ${playerId} 断线，房间 ${room.id} 暂停，等待重连 (${RECONNECT_TIMEOUT_MS/1000}s)`)
    } else if (room && room.status === 'waiting') {
      // 等待中的房间直接解散
      rooms.delete(player.roomId)
      console.log(`[房间] 房间 ${room.id} 已解散（房主断线）`)
    }
  }
}

function handleReconnect(playerId, msg) {
  const roomId = msg.roomId
  if (!roomId) {
    sendTo(playerId, { type: 'error', message: '缺少房間號' })
    return
  }

  const room = rooms.get(roomId)
  if (!room) {
    sendTo(playerId, { type: 'error', message: '房間不存在或已結束' })
    return
  }

  // 验证身份：必须是该房间的玩家
  const expectedId = room.players.get(playerId)
  if (!expectedId) {
    sendTo(playerId, { type: 'error', message: '你不是該房間的玩家' })
    return
  }

  // 房间状态检查
  if (room.status === 'finished') {
    sendTo(playerId, { type: 'error', message: '對局已結束' })
    return
  }

  // 清除重连计时器
  if (room.reconnectTimer) {
    clearTimeout(room.reconnectTimer)
    room.reconnectTimer = null
  }
  room.disconnectedAt = null
  room.disconnectedPlayer = null

  // 恢复房间：更新 player 的 ws 引用
  const player = players.get(playerId)
  if (player) {
    player.roomId = roomId
  }

  // 恢复棋钟（从暂停的那一刻继续）
  room.status = 'playing'
  startClock(room)

  // 通知双方重连成功
  const color = room.players.get(playerId)
  const opponentId = color === 'red' ? room.blackPlayer : room.redPlayer

  // 给重连方发送完整状态恢复
  sendTo(playerId, {
    type: 'reconnect_ok',
    roomId: room.id,
    color,
    board: room.moveHistory.length > 0 ? room.moveHistory[room.moveHistory.length - 1].board : null,
    clock: room.clock,
    turn: room.turn,
    moveHistory: room.moveHistory,
    timeControl: room.timeControl
  })

  // 通知对手对方已重连
  if (opponentId) {
    sendTo(opponentId, {
      type: 'opponent_reconnected',
      message: '對手已重連，對局繼續'
    })
  }

  console.log(`[重连] 玩家 ${playerId} 重连房间 ${roomId} 成功`)
}

// ====== 用户账号系统 ======

/**
 * 登录处理
 * 客户端发送：{ type: 'login', deviceId: 'xxx', nickname: 'xxx' }
 * 服务端返回：{ type: 'login_ok', openid: 'xxx', stats: {...} }
 */
function handleLogin(playerId, msg) {
  const deviceId = msg.deviceId || playerId
  const nickname = msg.nickname || ('棋手_' + playerId.slice(0, 4))

  // 用 deviceId 作为 openid（模拟模式），真实上线后可改为 code -> wx.login
  const openid = 'open_' + deviceId.replace(/[^a-zA-Z0-9]/g, '_')

  // 绑定玩家
  openidToPlayerId.set(openid, playerId)
  const player = players.get(playerId)
  if (player) {
    player.openid = openid
  }

  // 创建或更新用户
  if (!users.has(openid)) {
    users.set(openid, {
      nickname,
      openid,
      total: 0,
      win: 0,
      lose: 0,
      draw: 0,
      recentRecords: []
    })
  }

  const user = users.get(openid)
  // 更新昵称（如果传了新昵称）
  if (user.nickname !== nickname) {
    user.nickname = nickname
  }

  console.log(`[登录] 玩家 ${playerId} -> 用户 ${openid} (${user.nickname})`)

  sendTo(playerId, {
    type: 'login_ok',
    openid,
    nickname: user.nickname,
    stats: {
      total: user.total,
      win: user.win,
      lose: user.lose,
      draw: user.draw,
      winRate: user.total > 0 ? Math.round(user.win / user.total * 100) : 0
    }
  })
}

/**
 * 同步战绩
 * 客户端发送：{ type: 'sync_record', result: 'win'|'lose'|'draw', moveCount: 30, myTime: '05:23', opponentTime: '06:45', reason: '将杀', opponentName: 'xxx' }
 * 服务端返回：{ type: 'sync_record_ok', stats: {...} }
 */
function handleSyncRecord(playerId, msg) {
  const player = players.get(playerId)
  if (!player || !player.openid) {
    sendTo(playerId, { type: 'error', message: '请先登录' })
    return
  }

  const user = users.get(player.openid)
  if (!user) return

  // 更新统计数据
  user.total++
  if (msg.result === 'win') user.win++
  else if (msg.result === 'lose') user.lose++
  else if (msg.result === 'draw') user.draw++

  // 记录最近对局（最多保留30条）
  const record = {
    result: msg.result,
    moveCount: msg.moveCount || 0,
    myTime: msg.myTime || '00:00',
    opponentTime: msg.opponentTime || '00:00',
    reason: msg.reason || '',
    opponentName: msg.opponentName || '未知',
    timestamp: Date.now(),
    date: new Date().toLocaleString('zh-CN')
  }
  user.recentRecords.unshift(record)
  if (user.recentRecords.length > 30) {
    user.recentRecords = user.recentRecords.slice(0, 30)
  }

  console.log(`[战绩] ${user.nickname}: ${msg.result} (${user.win}/${user.total})`)

  sendTo(playerId, {
    type: 'sync_record_ok',
    stats: {
      total: user.total,
      win: user.win,
      lose: user.lose,
      draw: user.draw,
      winRate: Math.round(user.win / user.total * 100)
    }
  })
}

/**
 * 查询战绩
 * 客户端发送：{ type: 'get_stats' }
 * 服务端返回：{ type: 'stats_data', nickname, stats, recentRecords }
 */
function handleGetStats(playerId, msg) {
  const player = players.get(playerId)
  if (!player || !player.openid) {
    sendTo(playerId, { type: 'error', message: '请先登录' })
    return
  }

  const user = users.get(player.openid)
  if (!user) {
    sendTo(playerId, { type: 'error', message: '用户数据不存在' })
    return
  }

  sendTo(playerId, {
    type: 'stats_data',
    nickname: user.nickname,
    stats: {
      total: user.total,
      win: user.win,
      lose: user.lose,
      draw: user.draw,
      winRate: user.total > 0 ? Math.round(user.win / user.total * 100) : 0
    },
    recentRecords: user.recentRecords
  })
}

function cleanupRoom(room) {
  if (room.reconnectTimer) {
    clearTimeout(room.reconnectTimer)
    room.reconnectTimer = null
  }
  // 延迟 5 秒后彻底删除房间
  setTimeout(() => {
    rooms.delete(room.id)
  }, 5000)
}

function sendTo(playerId, data) {
  const player = players.get(playerId)
  if (player && player.ws.readyState === WebSocket.OPEN) {
    player.ws.send(JSON.stringify(data))
  }
}

function broadcast(room, data) {
  const msg = JSON.stringify(data)
  for (const [pid] of room.players) {
    const player = players.get(pid)
    if (player && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(msg)
    }
  }
}

console.log(`[启动] 中国象棋 WebSocket 服务器运行在 ws://0.0.0.0:${PORT}`)
