import { useEffect, useState, useCallback, useRef } from 'react';

interface WebSocketMessage {
    type: 'countdown' | 'changes';
    seconds?: number;
    hasChanges?: boolean;
}

interface UseWebSocketReturn {
    countdown: number;
    isConnected: boolean;
    onChangesDetected: (callback: () => void) => void;
}

export function useWebSocket(): UseWebSocketReturn {
    const [countdown, setCountdown] = useState(300); // 5 minutes in seconds
    const [isConnected, setIsConnected] = useState(false);
    const wsRef = useRef<WebSocket | null>(null);
    const changeCallbacksRef = useRef<Set<() => void>>(new Set());
    const reconnectTimeoutRef = useRef<number | undefined>(undefined);

    const connect = useCallback(() => {
        // Determine WebSocket URL based on current location
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}`;

        console.log('Connecting to WebSocket:', wsUrl);

        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('WebSocket connected');
            setIsConnected(true);
            // Clear any pending reconnection attempts
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
        };

        ws.onmessage = (event) => {
            try {
                const message: WebSocketMessage = JSON.parse(event.data);

                if (message.type === 'countdown' && message.seconds !== undefined) {
                    setCountdown(message.seconds);
                } else if (message.type === 'changes' && message.hasChanges) {
                    console.log('Changes detected, notifying callbacks');
                    // Notify all registered callbacks
                    changeCallbacksRef.current.forEach(callback => callback());
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        ws.onclose = () => {
            console.log('WebSocket disconnected');
            setIsConnected(false);
            wsRef.current = null;

            // Attempt to reconnect after 5 seconds
            reconnectTimeoutRef.current = window.setTimeout(() => {
                console.log('Attempting to reconnect...');
                connect();
            }, 5000);
        };

        wsRef.current = ws;
    }, []);

    useEffect(() => {
        connect();

        // Cleanup on unmount
        return () => {
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [connect]);

    const onChangesDetected = useCallback((callback: () => void) => {
        changeCallbacksRef.current.add(callback);

        // Return cleanup function
        return () => {
            changeCallbacksRef.current.delete(callback);
        };
    }, []);

    return {
        countdown,
        isConnected,
        onChangesDetected,
    };
}
