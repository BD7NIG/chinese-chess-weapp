const app = getApp()

Page({
  data: {
    nickname: '棋手',
    totalGames: 0,
    winGames: 0,
    loseGames: 0,
    drawGames: 0,
    winRate: 0,
    winRateClass: 'mid',
    records: [],
    loading: true
  },

  _pageId: 'profile',

  onLoad() {
    this._pageId = 'profile_' + Date.now()
    // 先显示本地缓存数据
    this.loadLocalData()
  },

  onShow() {
    app.registerMessageHandler(this._pageId, (msg) => this.handleMessage(msg))
    // 请求服务端最新数据
    this.fetchServerStats()
  },

  onHide() {
    app.unregisterMessageHandler(this._pageId)
  },

  onUnload() {
    app.unregisterMessageHandler(this._pageId)
  },

  loadLocalData() {
    try {
      const cached = wx.getStorageSync('chess_user_cache')
      if (cached) {
        const data = JSON.parse(cached)
        this.setData({
          nickname: data.nickname || '棋手',
          totalGames: data.total || 0,
          winGames: data.win || 0,
          winRate: data.winRate || 0
        })
      }
    } catch (e) {}

    // 从本地棋谱也统计一份
    try {
      const raw = wx.getStorageSync('chess_records')
      if (raw) {
        const records = JSON.parse(raw)
        if (Array.isArray(records) && records.length > 0) {
          const win = records.filter(r => r.result === 'win').length
          const lose = records.filter(r => r.result === 'lose').length
          const draw = records.filter(r => r.result === 'draw').length
          const total = records.length
          const rate = total > 0 ? Math.round(win / total * 100) : 0
          let cls = 'mid'
          if (rate >= 60) cls = 'high'
          else if (rate <= 30) cls = 'low'

          this.setData({
            totalGames: total,
            winGames: win,
            loseGames: lose,
            drawGames: draw,
            winRate: rate,
            winRateClass: cls,
            loading: false
          })
        }
      }
    } catch (e) {}
  },

  fetchServerStats() {
    const ws = app.globalData.ws
    if (!ws || !app.globalData.wsConnected) {
      this.setData({ loading: false })
      return
    }
    ws.send(JSON.stringify({ type: 'get_stats' }))
  },

  handleMessage(msg) {
    switch (msg.type) {
      case 'stats_data':
        this.handleStatsData(msg)
        break
      case 'login_ok':
        // 登录成功后自动请求数据
        this.fetchServerStats()
        break
    }
  },

  handleStatsData(msg) {
    const stats = msg.stats || { total: 0, win: 0, lose: 0, draw: 0, winRate: 0 }
    const records = msg.recentRecords || []
    let cls = 'mid'
    if (stats.winRate >= 60) cls = 'high'
    else if (stats.winRate <= 30) cls = 'low'

    this.setData({
      nickname: msg.nickname || this.data.nickname,
      totalGames: stats.total,
      winGames: stats.win,
      loseGames: stats.lose,
      drawGames: stats.draw,
      winRate: stats.winRate,
      winRateClass: cls,
      records: records.slice(0, 20),
      loading: false
    })

    // 更新缓存
    try {
      wx.setStorageSync('chess_user_cache', JSON.stringify({
        nickname: msg.nickname,
        total: stats.total,
        win: stats.win,
        winRate: stats.winRate
      }))
    } catch (e) {}
  },

  onBack() {
    wx.navigateBack()
  }
})
