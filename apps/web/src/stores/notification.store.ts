import { create } from 'zustand';

export interface MessageNotification {
  conversationId: string;
  contactName: string;
  lastMessage: string;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

interface NotificationState {
  messageNotifications: MessageNotification[];
  activeConversationId: string | null;
  addMessage: (payload: {
    conversationId: string;
    contactName: string;
    message: string;
    timestamp: string;
  }) => void;
  setActiveConversation: (conversationId: string | null) => void;
  markConversationRead: (conversationId: string) => void;
  markAllRead: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  messageNotifications: [],
  activeConversationId: null,

  addMessage: ({ conversationId, contactName, message, timestamp }) =>
    set((state) => {
      const idx = state.messageNotifications.findIndex(
        (n) => n.conversationId === conversationId,
      );
      if (idx >= 0) {
        const updated = [...state.messageNotifications];
        const existing = updated[idx]!;
        updated[idx] = {
          ...existing,
          contactName,
          lastMessage: message,
          unreadCount: existing.unreadCount + 1,
          updatedAt: timestamp,
        };
        return { messageNotifications: updated };
      }
      return {
        messageNotifications: [
          ...state.messageNotifications,
          {
            conversationId,
            contactName,
            lastMessage: message,
            unreadCount: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
      };
    }),

  setActiveConversation: (conversationId) => set({ activeConversationId: conversationId }),

  markConversationRead: (conversationId) =>
    set((state) => ({
      messageNotifications: state.messageNotifications.filter(
        (n) => n.conversationId !== conversationId,
      ),
    })),

  markAllRead: () => set({ messageNotifications: [] }),
}));
