#!/bin/bash
# Test APU server by connecting a client and sending game commands

# Ports (matching ObjectMUD's 6119/6120/6121 pattern)
GAME_PORT=${1:-6122}
CLIENT_PORT=${2:-6123}

# Create a named pipe to keep client connection open
FIFO=/tmp/apu_client_fifo
rm -f $FIFO
mkfifo $FIFO

# Start client connection in background
echo "Starting client connection..."
cat $FIFO | nc localhost $CLIENT_PORT > /tmp/apu_client_output.raw 2>&1 &
CLIENT_PID=$!
sleep 1

# Send game commands
echo "Sending game commands..."
{
echo '{"cmd":"init","cols":80,"rows":24}'
sleep 0.2
echo '{"cmd":"create_window","id":"main","x":5,"y":2,"width":40,"height":12,"border":"single","title":"Hello APU"}'
sleep 0.2
echo '{"cmd":"print","window":"main","x":2,"y":2,"text":"APU is working!","fg":10,"bg":0}'
sleep 0.2
echo '{"cmd":"print","window":"main","x":2,"y":4,"text":"Rust + Tokio TCP server","fg":14,"bg":0}'
sleep 0.2
echo '{"cmd":"flush","force_full":true}'
sleep 0.5
} | nc localhost $GAME_PORT

# Wait a bit for output to arrive
sleep 0.5

# Close client connection
echo "" > $FIFO
sleep 0.2
kill $CLIENT_PID 2>/dev/null

# Show what the client received (convert escape sequences for display)
echo ""
echo "=== Client received (raw bytes): ==="
xxd /tmp/apu_client_output.raw | head -30

echo ""
echo "=== Rendered (if terminal supports ANSI): ==="
cat /tmp/apu_client_output.raw

# Cleanup
rm -f $FIFO /tmp/apu_client_output.raw

echo ""
echo ""
echo "Test complete!"
