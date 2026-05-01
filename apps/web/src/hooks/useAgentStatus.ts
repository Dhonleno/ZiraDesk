import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentStatusApi } from '../services/api';

export function useAgentStatus(enabled = true) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['agent-status'],
    queryFn: agentStatusApi.getStatus,
    enabled,
    refetchInterval: 30_000,
  });

  const startPause = useMutation({
    mutationFn: (data: { reason: string; notes?: string }) => agentStatusApi.startPause(data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agent-status'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'auto-assign'] });
    },
  });

  const endPause = useMutation({
    mutationFn: () => agentStatusApi.endPause(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['agent-status'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'auto-assign'] });
    },
  });

  return {
    ...query,
    status: query.data?.status ?? 'online',
    pauseReason: query.data?.pause_reason ?? null,
    pauseStartedAt: query.data?.pause_started_at ?? null,
    pauseNotes: query.data?.pause_notes ?? null,
    durationSeconds: query.data?.duration_seconds ?? 0,
    isAvailable: query.data?.is_available ?? true,
    startPause: startPause.mutateAsync,
    endPause: endPause.mutateAsync,
    isStartingPause: startPause.isPending,
    isEndingPause: endPause.isPending,
  };
}

