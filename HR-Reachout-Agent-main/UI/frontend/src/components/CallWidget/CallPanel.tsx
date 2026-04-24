import { X } from "lucide-react";
import { CloseIcon } from "@/components/CloseIcon";
import { useEffect, useState, useCallback } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import {
  RoomContext,
  RoomAudioRenderer,
  VideoTrack,
  BarVisualizer,
  DisconnectButton,
  TrackToggle,
  useVoiceAssistant,
  useLocalParticipant,
  useLocalParticipantPermissions,
  usePersistentUserChoices,
  MediaDeviceMenu,
} from "@livekit/components-react";
import TranscriptionView from "@/components/TranscriptionView";
import { CustomBarVisualizer } from "./CustomBarVisualizer.tsx";

interface CallPanelProps {
  isOpen: boolean;
  transcripts: string[];
  onClose: () => void;
  onOpenChat: () => void;
  messages: Array<{ content: string; isUser: boolean; type?: string  }>;
}

const params = new URLSearchParams(window.location.search);
const agentId = params.get("agent_id") || "default-agent";

console.log("CallPanel received agent id:", agentId);

export const CallPanel = ({ isOpen, transcripts, onClose , onOpenChat , messages }: CallPanelProps) => {
  const [room] = useState(() => new Room());

    const getSessionId = () => {
    let sessionId = sessionStorage.getItem("session_id");
    if (!sessionId) {
      sessionId = `session_${new Date().toISOString().slice(0, 10)}_${crypto.randomUUID()}`;
      sessionStorage.setItem("session_id", sessionId);
    }
    return sessionId;
  };

  const sessionId = getSessionId();

  const onConnect = useCallback(async () => {
    // const url = "http://localhost:8000/chat/connection-details";
    const url = `${import.meta.env.VITE_BACKEND_URL}/chat/connection-details?session_id=${sessionId}&agent_id=${agentId}`;
    console.log("Session ID: ", sessionId, "Agent ID: ", agentId);
    const response = await fetch(url);

    if (!response.ok) {
      alert("Failed to get connection details");
      return;
    }

    const data = await response.json();
    console.log("Data: ", data)
    await room.connect(data.serverUrl, data.participantToken);
    await room.localParticipant.setMicrophoneEnabled(true);

    console.log(" Connected to room");
  }, [room]);

  useEffect(() => {
    room.on(RoomEvent.MediaDevicesError, (error) => {
      console.error(error);
      alert("Microphone access denied or unavailable.");
    });

    return () => {
      room.disconnect();
    };
  }, [room]);

  useEffect(() => {
    room.on(RoomEvent.ParticipantConnected, (p) => {
      console.log("[Connected]", p.identity);
    });
    room.on(RoomEvent.ParticipantDisconnected, (p) => {
      console.log("[Disconnected]", p.identity);
    });
  }, [room]);

  if (!isOpen) return null;

  return (
    <RoomContext.Provider value={room}>
      <div data-lk-theme="default" className="!overflow-y-hidden">
        <div className="w-[500px] h-[600px] rounded-2xl shadow-2xl p-6 bg-gradient-to-br from-white via-slate-100 to-slate-200 fixed bottom-24 right-10 z-50 flex flex-col border border-gray-200 animate-fade-in">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">AI Voice Call</h2>
            <button onClick={onClose} aria-label="Close call panel">
              <X className="w-5 h-5 text-gray-500 hover:text-black" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2">
            <VoiceAssistantContent onConnect={onConnect} isOpen={isOpen} onOpenChat={onOpenChat} onClose={onClose} messages={messages} />
          </div>
        </div>
        <RoomAudioRenderer />
      </div>
    </RoomContext.Provider>
  );
};

function VoiceAssistantContent({
  onConnect,
  isOpen,
  onOpenChat,
  onClose,
  messages,
}: {
  onConnect: () => void;
  isOpen: boolean;
  onOpenChat:  () => void,  
  onClose:  () => void ,  
  messages: Array<{ content: string; isUser: boolean; type?: string }>;      
}) {
  const { state, videoTrack, audioTrack } = useVoiceAssistant();
  const [showVisualizer, setShowVisualizer] = useState(false);

  const localPermissions = useLocalParticipantPermissions();
  const { microphoneTrack, localParticipant } = useLocalParticipant();

  const micTrackRef = {
    participant: localParticipant,
    source: Track.Source.Microphone,
    publication: microphoneTrack,
    track: microphoneTrack?.track,
  };

  const { saveAudioInputEnabled, saveAudioInputDeviceId } =
    usePersistentUserChoices({
      preventSave: false,
    });

  const microphoneOnChange = useCallback(
    (enabled: boolean, isUserInitiated: boolean) => {
      console.log(
        "[Toggle] Microphone changed:",
        enabled,
        "Initiated by user?",
        isUserInitiated
      );
      if (isUserInitiated) {
        saveAudioInputEnabled(enabled);
      }
    },
    [saveAudioInputEnabled]
  );

  useEffect(() => {
    const isSubscribed = audioTrack?.publication?.isSubscribed ?? false;
    setShowVisualizer(isSubscribed);
    console.log("[AudioTrack] Agent audio track subscribed?", isSubscribed);
  }, [audioTrack?.publication?.isSubscribed]);

  useEffect(() => {
    console.log("[VoiceAssistant] State:", state);
    console.log("[Agent audioTrack]:", audioTrack);
    console.log("[Local micTrack]:", microphoneTrack);
  }, [state, audioTrack, microphoneTrack]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (isOpen && state === "disconnected") {
        onConnect();
      }
    }, 200);

    return () => clearTimeout(timeout);
  }, [isOpen, state, onConnect]);

  return (
    <>
      {videoTrack ? (
        <div className="h-32 w-full rounded">
          <VideoTrack trackRef={videoTrack} />
        </div>
      ) : (
        <div className="h-24 flex items-center justify-center">
          {showVisualizer ? (
            <CustomBarVisualizer
              trackRef={audioTrack}
              state={state}
              barCount={5}
              className="agent-bar-visualizer"
            />
          ) : (
            <p className="text-sm">Connecting...</p>
          )}
        </div>
      )}

      <div className="overflow-y-auto h-[70%] p-2 rounded text-white">
        <TranscriptionView messages={messages}/>
      </div>

      <div className="flex justify-center gap-4 items-center">
        <div className="bg-white w-36 flex justify-center gap-5 items-center p-2 !cursor-pointer">
          <TrackToggle
            source={Track.Source.Microphone}
            showIcon={true}
            onChange={microphoneOnChange}
            className="pr-2"
          >
            <BarVisualizer
              trackRef={micTrackRef}
              barCount={10}
              className="user-bar-visualizer"
              options={{ minHeight: 10, maxHeight: 40 }}
            />
          </TrackToggle>

          <MediaDeviceMenu
            kind="audioinput"
            onActiveDeviceChange={(_, deviceId) =>
              saveAudioInputDeviceId(deviceId ?? "default")
            }
          />
          {/* <DisconnectButton>
                <CloseIcon />
              </DisconnectButton> */}
        </div>
        <div className="bg-custom-red-500 p-1 my-auto border rounded-lg cursor-pointer" onClick={() => { onClose(); onOpenChat(); }}>
          <X className="h-5 w-5 text-gray-200"/>
        </div>
      </div>

    </>
  );
}
