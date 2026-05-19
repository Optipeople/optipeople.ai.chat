// Resolves once the peer connection has finished gathering ICE
// candidates. The GA Realtime API exchanges SDP over a single HTTP POST
// (non-trickle ICE), so the offer we send must already contain every
// candidate. Sending it too early — right after setLocalDescription —
// produces a one-way connection: the model's audio arrives but the
// microphone never reaches the server, so VAD never triggers.
export function waitForIceGathering(
  pc: RTCPeerConnection,
  timeoutMs = 3000,
): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    // Fall back after a timeout — on some networks gathering never
    // formally "completes", and a mostly-gathered offer still connects.
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", check);
  });
}
