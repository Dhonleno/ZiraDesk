import { Call as TwilioCall, Device } from '@twilio/voice-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { callsApi } from '../services/api';

type CallStatus =
  | 'idle'
  | 'connecting'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'failed';

export function useTwilioCall() {
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<TwilioCall | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [status, setStatus] = useState<CallStatus>('idle');
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  const startTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    setDuration(0);
    timerRef.current = setInterval(() => {
      setDuration((previous) => previous + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setDuration(0);
  }, []);

  useEffect(() => {
    let isMounted = true;

    const initDevice = async () => {
      try {
        const { token } = await callsApi.getToken();

        const device = new Device(token, {
          logLevel: 1,
          codecPreferences: [TwilioCall.Codec.Opus, TwilioCall.Codec.PCMU],
        });

        device.on('registered', () => {
          console.log('[Twilio] Device registered');
        });

        device.on('error', (error) => {
          console.error('[Twilio] Device error:', error);
          if (!isMounted) return;
          setStatus('failed');
        });

        device.on('incoming', (call) => {
          callRef.current = call;
          call.accept();
          setStatus('in-progress');
          startTimer();

          call.on('disconnect', () => {
            setStatus('completed');
            stopTimer();
            callRef.current = null;
            setIsMuted(false);
          });

          call.on('error', () => {
            setStatus('failed');
            stopTimer();
            callRef.current = null;
            setIsMuted(false);
          });
        });

        await device.register();
        if (!isMounted) {
          device.destroy();
          return;
        }

        deviceRef.current = device;
      } catch (error) {
        console.error('[Twilio] Init error:', error);
        if (isMounted) setStatus('failed');
      }
    };

    void initDevice();

    return () => {
      isMounted = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      deviceRef.current?.destroy();
      deviceRef.current = null;
      callRef.current = null;
    };
  }, [startTimer, stopTimer]);

  const makeCall = useCallback(async (toPhone: string, conversationId: string) => {
    if (!deviceRef.current) return;

    setStatus('connecting');

    try {
      const onlyDigits = toPhone.replace(/\D/g, '');
      const to = onlyDigits.startsWith('55') ? `+${onlyDigits}` : `+55${onlyDigits}`;

      const call = await deviceRef.current.connect({
        params: {
          To: to,
          ConversationId: conversationId,
        },
      });

      callRef.current = call;

      call.on('ringing', () => {
        setStatus('ringing');
      });

      call.on('accept', () => {
        setStatus('in-progress');
        startTimer();
      });

      call.on('disconnect', () => {
        setStatus('completed');
        stopTimer();
        callRef.current = null;
        setIsMuted(false);
      });

      call.on('error', () => {
        setStatus('failed');
        stopTimer();
        callRef.current = null;
        setIsMuted(false);
      });
    } catch (error) {
      console.error('[Twilio] Call error:', error);
      setStatus('failed');
    }
  }, [startTimer, stopTimer]);

  const hangUp = useCallback(() => {
    callRef.current?.disconnect();
    callRef.current = null;
    setStatus('idle');
    setIsMuted(false);
    stopTimer();
  }, [stopTimer]);

  const toggleMute = useCallback(() => {
    const activeCall = callRef.current;
    if (!activeCall) return;
    const muted = activeCall.isMuted();
    activeCall.mute(!muted);
    setIsMuted(!muted);
  }, []);

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  };

  return {
    status,
    duration,
    formattedDuration: formatDuration(duration),
    isMuted,
    isActive: ['connecting', 'ringing', 'in-progress'].includes(status),
    makeCall,
    hangUp,
    toggleMute,
  };
}
