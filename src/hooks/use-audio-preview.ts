import { useCallback, useEffect, useRef, useState } from "react";

interface PreviewState {
  trackId: string | null;
  playing: boolean;
  progress: number; // 0-1
  duration: number;
  loading: boolean;
}

const initialState: PreviewState = {
  trackId: null,
  playing: false,
  progress: 0,
  duration: 0,
  loading: false,
};

/** Singleton audio element shared across the app */
let globalAudio: HTMLAudioElement | null = null;
let globalListeners: Set<(state: PreviewState) => void> = new Set();
let globalState: PreviewState = { ...initialState };

function notify(partial: Partial<PreviewState>) {
  globalState = { ...globalState, ...partial };
  globalListeners.forEach((fn) => fn(globalState));
}

function getAudio(): HTMLAudioElement {
  if (!globalAudio) {
    globalAudio = new Audio();
    globalAudio.volume = 0.7;

    globalAudio.addEventListener("timeupdate", () => {
      if (globalAudio!.duration) {
        notify({ progress: globalAudio!.currentTime / globalAudio!.duration });
      }
    });

    globalAudio.addEventListener("ended", () => {
      notify({ playing: false, progress: 0 });
    });

    globalAudio.addEventListener("loadedmetadata", () => {
      notify({ duration: globalAudio!.duration, loading: false });
    });

    globalAudio.addEventListener("error", () => {
      notify({ playing: false, loading: false });
    });
  }
  return globalAudio;
}

export function useAudioPreview() {
  const [state, setState] = useState<PreviewState>(globalState);

  useEffect(() => {
    globalListeners.add(setState);
    // sync on mount
    setState(globalState);
    return () => {
      globalListeners.delete(setState);
    };
  }, []);

  const play = useCallback((trackId: string, previewUrl: string) => {
    const audio = getAudio();

    if (globalState.trackId === trackId && globalState.playing) {
      // Pause current
      audio.pause();
      notify({ playing: false });
      return;
    }

    if (globalState.trackId === trackId && !globalState.playing) {
      // Resume
      audio.play();
      notify({ playing: true });
      return;
    }

    // New track
    notify({ trackId, playing: false, progress: 0, duration: 0, loading: true });
    audio.src = previewUrl;
    audio.load();
    audio.play().then(() => {
      notify({ playing: true, loading: false });
    }).catch(() => {
      notify({ playing: false, loading: false });
    });
  }, []);

  const stop = useCallback(() => {
    const audio = getAudio();
    audio.pause();
    audio.currentTime = 0;
    notify({ ...initialState });
  }, []);

  const seek = useCallback((fraction: number) => {
    const audio = getAudio();
    if (audio.duration) {
      audio.currentTime = fraction * audio.duration;
    }
  }, []);

  return {
    ...state,
    play,
    stop,
    seek,
    isPlaying: (trackId: string) => state.trackId === trackId && state.playing,
    isLoading: (trackId: string) => state.trackId === trackId && state.loading,
  };
}
