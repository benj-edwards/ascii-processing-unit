#!/bin/bash
# Test APU input handling with mouse support

GAME_PORT=${1:-6122}
CLIENT_PORT=${2:-6123}

echo "=== APU Input Test ==="
echo "Game port: $GAME_PORT"
echo "Client port: $CLIENT_PORT"
echo ""
echo "Instructions:"
echo "1. Connect as a client:  telnet localhost $CLIENT_PORT"
echo "2. Run this script to connect as a game and see input events"
echo ""
echo "Connecting to game port and enabling mouse..."
echo ""

# Connect to game port and set up display with mouse
{
echo '{"cmd":"init","cols":80,"rows":24}'
sleep 0.2
echo '{"cmd":"create_window","id":"main","x":2,"y":1,"width":76,"height":20,"border":"double","title":"Input Test"}'
sleep 0.2
echo '{"cmd":"print","window":"main","x":2,"y":2,"text":"Press keys or click the mouse!","fg":14}'
sleep 0.2
echo '{"cmd":"print","window":"main","x":2,"y":4,"text":"Arrow keys, WASD, and mouse clicks will appear below.","fg":7}'
sleep 0.2
echo '{"cmd":"print","window":"main","x":2,"y":6,"text":"Press Ctrl+C to exit.","fg":8}'
sleep 0.2
echo '{"cmd":"enable_mouse","mode":"sgr"}'
sleep 0.2
echo '{"cmd":"flush","force_full":true}'
# Keep connection open to receive events
sleep 999999
} | nc localhost $GAME_PORT
