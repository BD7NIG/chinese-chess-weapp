// 全局消息总线
const messageHandlers = {}

App({
  globalData: {
    userInfo: null,        // { openid, nickname, stats, records }
    wsConnected: false,
    serverUrl: 'ws://112.93.60.49:3000',
    ws: null,
    pendingRoomId: null,
    loginInited: false     // 防止重复登录
  },

  /**
   * 注册消息处理器
   * @param {string} pageId - 页面唯一标识
   * @param {function} handler - 消息处理函数
   */
  registerMessageHandler(pageId, handler) {
    messageHandlers[pageId] = handler
  },

  /**
   * 注销消息处理器
   */
  unregisterMessageHandler(pageId) {
    delete messageHandlers[pageId]
  },

  /**
   * 分发消息到所有注册的处理器
   */
  dispatchMessage(data) {
    for (const id of Object.keys(messageHandlers)) {
      try {
        messageHandlers[id](data)
      } catch (e) {
        console.error(`[消息] ${id} 处理异常:`, e)
      }
    }
  },

  /**
   * 登录到服务端账号系统
   * 使用本地存储的设备ID模拟，未来可改为 wx.login
   */
  doLogin() {
    if (this.globalData.loginInited) return
    this.globalData.loginInited = true

    // 从本地存储获取设备ID（应用启动后唯一不变）
    let deviceId = ''
    try {
      deviceId = wx.getStorageSync('chess_device_id')
    } catch (e) {}
    if (!deviceId) {
      deviceId = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      try {
        wx.setStorageSync('chess_device_id', deviceId)
      } catch (e) {}
    }

    // 获取上次使用的昵称
    let nickname = ''
    try {
      nickname = wx.getStorageSync('chess_nickname')
    } catch (e) {}

    // 发送登录消息
    const attemptLogin = () => {
      const ws = this.globalData.ws
      if (!ws || !this.globalData.wsConnected) {
        // 等待连接就绪
        setTimeout(() => attemptLogin(), 500)
        return
      }
      ws.send(JSON.stringify({
        type: 'login',
        deviceId,
        nickname: nickname || ''
      }))
    }

    // 如果 ws 已连接直接发，否则等500ms
    if (this.globalData.ws && this.globalData.wsConnected) {
      attemptLogin()
    } else {
      setTimeout(() => attemptLogin(), 500)
    }
  }
})
