const state = {
    socket: null, 
    myNick: '',
    myUserData: {},
    currentChatContext: { type: 'none', with: null },
    lastActiveRoom: '#General', 
    pendingRoomJoin: null, // <-- NUEVA LÍNEA: Para recordar a qué sala intentábamos unirnos
    privateMessageHistories: {},
    publicMessageHistories: {},
    joinedRooms: new Set(),
    activePrivateChats: new Set(),
    usersWithUnreadMessages: new Set(),
    disconnectedPrivateChats: new Set(),
    currentRoomUsers: [],
    allUsersData: {},
    roomUserLists: {}, 
    selectedAvatarFile: null,
    ignoredNicks: new Set(),
    isFirstLogin: true,
    typingTimer: null,
    isTyping: false,
    usersTyping: new Set(),
    suggestionState: { list: [], index: -1, originalWord: "" },
    mediaRecorder: null,
    audioChunks: [],
    audioBlob: null,
    audioStream: null,
    activityMonitorInterval: null,
    replyingTo: null, 
    isAFK: false,
    TYPING_TIMER_LENGTH: 1500,
    sonidoMencion: new Audio('notification.mp3'),
    audioUnlocked: false,
};

state.sonidoMencion.volume = 0.7;

export default state;