const app = getApp()

Page({
  data: {
    wsConnected: false,
    showJoinModal: false,
    showSettings: false,
    roomId: '',
    settings: {
      music: true,
      sound: true,
      timeIndex: 1
    },
    timeOptions: ['5 分', '10 分', '15 分', '20 分', '30 分'],
    // 用户信息
    nickname: '未登錄',
    userInitial: '?',
    totalGames: 0,
    winGames: 0,
    winRate: 0
  },

  pendingRoomId: null,
  _pageId: '',

  onLoad() {
    this.connectWebSocket()
    this._pageId = 'index'

    // 从缓存加载之前的战绩数据（如果有）
    this.loadCachedStats()
  },

  onShow() {
    app.registerMessageHandler(this._pageId, (msg) => this.handleMessage(msg))

    const pendingId = app.globalData.pendingRoomId
    if (app.globalData.wsConnected && pendingId) {
      this.pendingRoomId = pendingId
      this.tryReconnectRoom(pendingId)
    }
  },

  onHide() {
    app.unregisterMessageHandler(this._pageId)
  },

  onUnload() {
    app.unregisterMessageHandler(this._pageId)
  },

  loadCachedStats() {
    try {
      const cached = wx.getStorageSync('chess_user_cache')
      if (cached) {
        const data = JSON.parse(cached)
        this.setData({
          nickname: data.nickname || '未登錄',
          userInitial: (data.nickname || '?')[0],
          totalGames: data.total || 0,
          winGames: data.win || 0,
          winRate: data.winRate || 0
        })
      }
    } catch (e) {}
  },

  connectWebSocket() {
    const wsUrl = app.globalData.serverUrl
    const ws = wx.connectSocket({ url: wsUrl })

    ws.onOpen(() => {
      this.setData({ wsConnected: true })
      app.globalData.wsConnected = true
      app.globalData.ws = ws

      // 连接后自动登录
      app.doLogin()

      if (this.pendingRoomId) {
        this.tryReconnectRoom(this.pendingRoomId)
      }
    })

    ws.onClose(() => {
      this.setData({ wsConnected: false })
      app.globalData.wsConnected = false
      app.globalData.loginInited = false  // 断线后重置登录标记
      setTimeout(() => this.connectWebSocket(), 3000)
    })

    ws.onMessage(res => {
      const msg = JSON.parse(res.data)
      app.dispatchMessage(msg)
    })

    app.globalData.ws = ws
  },

  tryReconnectRoom(roomId) {
    const ws = app.globalData.ws
    if (!ws || !roomId) return
    wx.showToast({ title: '嘗試重連對局...', icon: 'none', duration: 3000 })
    ws.send(JSON.stringify({
      type: 'reconnect',
      roomId
    }))
  },

  handleMessage(msg) {
    switch (msg.type) {
      case 'connected':
        // 收到连接确认后尝试登录
        app.doLogin()
        break
      case 'login_ok':
        // 登录成功，更新用户信息
        this.handleLoginOK(msg)
        break
      case 'stats_data':
        this.handleStatsData(msg)
        break
      case 'sync_record_ok':
        // 战绩同步成功，更新显示
        if (msg.stats) {
          this.setData({
            totalGames: msg.stats.total,
            winGames: msg.stats.win,
            winRate: msg.stats.winRate
          })
        }
        break
      case 'matched':
        this.setData({ wsConnected: true })
        wx.navigateTo({
          url: `/pages/play/play?roomId=${msg.roomId}&color=${msg.color}&timeControl=${msg.timeControl || 600000}`
        })
        break
      case 'room_created':
        this.setData({ roomId: msg.roomId })
        wx.showToast({ title: `房間號: ${msg.roomId}`, icon: 'none' })
        wx.navigateTo({
          url: `/pages/play/play?roomId=${msg.roomId}&color=red&isHost=true&timeControl=${msg.timeControl || 600000}`
        })
        break
      case 'joined':
        wx.navigateTo({
          url: `/pages/play/play?roomId=${msg.roomId}&color=black&timeControl=${msg.timeControl || 600000}`
        })
        break
      case 'error':
        wx.showToast({ title: msg.message, icon: 'none' })
        break
    }
  },

  handleLoginOK(msg) {
    const nickname = msg.nickname || '棋手'
    const stats = msg.stats || { total: 0, win: 0, winRate: 0 }

    this.setData({
      nickname,
      userInitial: nickname[0] || '?',
      totalGames: stats.total,
      winGames: stats.win,
      winRate: stats.winRate
    })

    // 缓存到本地
    try {
      wx.setStorageSync('chess_user_cache', JSON.stringify({
        nickname,
        total: stats.total,
        win: stats.win,
        winRate: stats.winRate
      }))
    } catch (e) {}

    // 存入全局
    app.globalData.userInfo = {
      openid: msg.openid,
      nickname
    }
  },

  handleStatsData(msg) {
    const stats = msg.stats || { total: 0, win: 0, winRate: 0 }
    this.setData({
      nickname: msg.nickname || this.data.nickname,
      userInitial: (msg.nickname || this.data.nickname)[0] || '?',
      totalGames: stats.total,
      winGames: stats.win,
      winRate: stats.winRate
    })
  },

  onMatch() {
    const ws = app.globalData.ws
    if (!ws) {
      wx.showToast({ title: '服務器未連接', icon: 'none' })
      return
    }
    ws.send(JSON.stringify({ type: 'match' }))
  },

  onCreateRoom() {
    const ws = app.globalData.ws
    if (!ws) {
      wx.showToast({ title: '服務器未連接', icon: 'none' })
      return
    }
    ws.send(JSON.stringify({ type: 'create_room' }))
  },

  onJoinRoom() {
    this.setData({ showJoinModal: true })
  },

  onRoomInput(e) {
    this.setData({ roomId: e.detail.value })
  },

  onCancelJoin() {
    this.setData({ showJoinModal: false, roomId: '' })
  },

  onConfirmJoin() {
    if (!this.data.roomId) {
      wx.showToast({ title: '請輸入房間號', icon: 'none' })
      return
    }
    const ws = app.globalData.ws
    ws.send(JSON.stringify({
      type: 'join_room',
      roomId: this.data.roomId
    }))
    this.setData({ showJoinModal: false, roomId: '' })
  },

  // 设置面板
  onOpenSettings() {
    this.setData({ showSettings: true })
  },

  onReplay() {
    wx.navigateTo({
      url: '/pages/replay/replay'
    })
  },

  // 战绩页面
  onViewProfile() {
    wx.navigateTo({
      url: '/pages/profile/profile'
    })
  },

  onVsAI() {
    wx.showActionSheet({
      itemList: ['簡單模式', '中等模式'],
      success: res => {
        const level = res.tapIndex === 0 ? 'easy' : 'medium'
        const color = Math.random() < 0.5 ? 'red' : 'black'
        wx.navigateTo({
          url: `/pages/play/play?ai=true&aiLevel=${level}&aiColor=${color === 'red' ? 'black' : 'red'}&color=${color}`
        })
      }
    })
  },

  onCloseSettings() {
    this.setData({ showSettings: false })
  },

  onToggleMusic() {
    const s = this.data.settings
    s.music = !s.music
    this.setData({ settings: s })
  },

  onToggleSound() {
    const s = this.data.settings
    s.sound = !s.sound
    this.setData({ settings: s })
  },

  onTimeChange(e) {
    const s = this.data.settings
    s.timeIndex = e.detail.value
    this.setData({ settings: s })
  },

  noop() {},

  onShareAppMessage() {
    return {
      title: '♟ 中國象棋 - 即時對戰',
      path: '/pages/index/index'
    }
  }
})
