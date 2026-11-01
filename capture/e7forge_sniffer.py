"""E7 Forge live-capture sidecar.

Passively sniffs Epic Seven game traffic (default TCP ports 3333/5222) on all
working interfaces using scapy + Npcap (Windows) / libpcap (Linux, macOS),
reassembles TCP payloads per ACK the same way Fribbels' scanner does, and
hands the buffers to E7 Forge over stdout. It never sends anything itself.

Protocol (JSON lines):
  stdout -> {"type": "ready" | "activity" | "buffers" | "error" | "log", ...}
  stdin  <- FLUSH | RESET | QUIT
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import threading
import time

MAX_BYTES = 256 * 1024 * 1024
out_lock = threading.Lock()


def emit(obj: dict) -> None:
    with out_lock:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ports", default="3333,5222")
    ap.add_argument("--iface", default="", help="Optional interface name; default sniffs all working interfaces")
    args = ap.parse_args()
    ports = [int(p) for p in args.ports.split(",") if p.strip().isdigit()]
    if not ports:
        emit({"type": "error", "code": "bad_ports", "message": "No valid ports given"})
        return 2

    try:
        from scapy.all import AsyncSniffer, IP, Raw, TCP, conf  # type: ignore
        try:
            from scapy.all import get_working_ifaces  # type: ignore
        except Exception:  # older scapy
            get_working_ifaces = None
        try:
            from scapy.sessions import TCPSession  # type: ignore
        except Exception:
            TCPSession = None
    except Exception as e:  # noqa: BLE001
        emit({"type": "error", "code": "no_scapy", "message": f"scapy is not installed: {e}"})
        return 3

    lock = threading.Lock()
    acks: dict[int, list[tuple[int, bytes]]] = {}
    seen: set[bytes] = set()
    stats = {"bytes": 0, "packets": 0}

    def on_packet(pkt) -> None:
        try:
            if IP not in pkt or TCP not in pkt or Raw not in pkt:
                return
            load = bytes(pkt[Raw].load)
            if not load:
                return
            h = hashlib.blake2b(load, digest_size=16).digest()
            with lock:
                if h in seen or stats["bytes"] > MAX_BYTES:
                    return
                seen.add(h)
                acks.setdefault(int(pkt[TCP].ack), []).append((int(pkt[TCP].seq), load))
                stats["bytes"] += len(load)
                stats["packets"] += 1
        except Exception as e:  # noqa: BLE001
            emit({"type": "log", "message": f"packet error: {e}"})

    bpf = "tcp and (" + " or ".join(f"port {p}" for p in ports) + ")"
    kwargs = {"prn": on_packet, "filter": bpf, "store": False}
    if TCPSession is not None:
        kwargs["session"] = TCPSession
    if args.iface:
        kwargs["iface"] = args.iface
    elif sys.platform != "darwin" and get_working_ifaces is not None:
        try:
            kwargs["iface"] = list(get_working_ifaces())
        except Exception:
            pass

    try:
        sniffer = AsyncSniffer(**kwargs)
        sniffer.start()
        time.sleep(0.8)
        if getattr(sniffer, "exception", None):
            raise sniffer.exception  # type: ignore[misc]
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        code = "no_pcap" if any(k in msg.lower() for k in ("pcap", "winpcap", "npcap", "libpcap", "layer 2")) else "sniff_failed"
        if "permission" in msg.lower() or "operation not permitted" in msg.lower():
            code = "permission"
        emit({"type": "error", "code": code, "message": msg})
        return 4

    ifaces = kwargs.get("iface")
    emit({"type": "ready", "filter": bpf, "ifaces": [str(getattr(i, "name", i)) for i in (ifaces if isinstance(ifaces, list) else [ifaces] if ifaces else [])]})

    stop = threading.Event()

    def reporter() -> None:
        last = -1
        while not stop.is_set():
            time.sleep(1.0)
            with lock:
                b, p, s = stats["bytes"], stats["packets"], len(acks)
            if b != last:
                emit({"type": "activity", "bytes": b, "packets": p, "streams": s, "capped": b > MAX_BYTES})
                last = b

    threading.Thread(target=reporter, daemon=True).start()

    def take_buffers(clear: bool) -> list[str]:
        with lock:
            snapshot = {k: list(v) for k, v in acks.items()}
            if clear:
                acks.clear()
                seen.clear()
                stats["bytes"] = 0
                stats["packets"] = 0
        bufs = []
        for parts in snapshot.values():
            parts.sort(key=lambda x: x[0])
            bufs.append(b"".join(p for _, p in parts).hex())
        return bufs

    for line in sys.stdin:
        cmd = line.strip().upper()
        if cmd == "FLUSH":
            emit({"type": "buffers", "data": take_buffers(clear=True)})
        elif cmd == "PEEK":
            emit({"type": "buffers", "data": take_buffers(clear=False)})
        elif cmd == "RESET":
            take_buffers(clear=True)
            emit({"type": "log", "message": "reset"})
        elif cmd == "QUIT":
            break
    stop.set()
    try:
        sniffer.stop()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
