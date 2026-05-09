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
  addMessage: (payload: {
    conversationId: string;
    contactName: string;
    message: string;
    timestamp: string;
  }) => void;
  markConversationRead: (conversationId: string) => void;
  markAllRead: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  messageNotifications: [],

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

  markConversationRead: (conversationId) =>
    set((state) => ({
      messageNotifications: state.messageNotifications.filter(
        (n) => n.conversationId !== conversationId,
      ),
    })),

  markAllRead: () => set({ messageNotifications: [] }),
}));
