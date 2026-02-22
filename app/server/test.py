import socket
import json
import time

def wiz_discovery_and_control():
    # 1. Setup the Broadcast Socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.settimeout(2)  # Wait 2 seconds for bulbs to respond

    broadcast_ip = "192.168.1.255"
    port = 38899
    
    # The 'getSystemConfig' method is the standard "Who are you?" for WiZ
    disc_msg = '{"method":"getSystemConfig","params":{}}'
    
    print("Searching for bulbs...")
    sock.sendto(bytes(disc_msg, "utf-8"), (broadcast_ip, port))

    found_bulbs = []

    # 2. Listen for responses
    try:
        while True:
            data, addr = sock.recvfrom(1024)
            response = json.loads(data.decode())
            # If the response has a MAC address, it's a WiZ bulb
            if "result" in response and "mac" in response["result"]:
                print(f"Found bulb at {addr[0]} (MAC: {response['result']['mac']})")
                found_bulbs.append(addr[0])
    except socket.timeout:
        print(f"Discovery finished. Found {len(found_bulbs)} bulb(s).")

    # 3. Control the found bulbs
    red_msg = '{"method":"setPilot","params":{"r":255,"g":0,"b":0}}'
    for ip in found_bulbs:
        print(f"Sending red command to {ip}...")
        sock.sendto(bytes(red_msg, "utf-8"), (ip, port))

    sock.close()

if __name__ == "__main__":
    wiz_discovery_and_control()