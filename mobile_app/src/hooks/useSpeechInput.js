import { useCallback, useEffect, useRef, useState } from 'react';

let SpeechRecognitionModule = null;
try {
  ({ ExpoSpeechRecognitionModule: SpeechRecognitionModule } = require('expo-speech-recognition'));
} catch (error) {
  console.warn('語音辨識原生模組未載入；請使用包含原生模組的應用程式版本。', error);
}

const ERROR_MESSAGES = {
  'not-allowed': '麥克風或語音辨識權限未允許，請至裝置設定開啟後再試。',
  'service-not-allowed': '裝置目前沒有可用的語音辨識服務，請改用打字。',
  'no-speech': '沒有聽到聲音，請靠近麥克風再試一次。',
  'audio-capture': '無法使用麥克風，請確認裝置後再試。',
  network: '語音辨識服務連線失敗，請確認網路後再試。',
  'language-not-supported': '裝置的語音辨識服務不支援繁體中文，請改用打字。',
  busy: '語音辨識服務忙碌中，請稍後再試。',
  interrupted: '語音辨識已中斷，請再試一次。',
};

const FALLBACK_ERROR = '語音辨識失敗，請再試一次或改用打字。';

function getInitialState() {
  if (!SpeechRecognitionModule) {
    return {
      supported: false,
      error: '此版本未包含語音辨識功能，請更新應用程式後再試。',
    };
  }

  try {
    const supported = SpeechRecognitionModule.isRecognitionAvailable();
    return {
      supported,
      error: supported ? '' : '裝置目前沒有可用的語音辨識服務，請改用打字。',
    };
  } catch (error) {
    console.error('檢查語音辨識服務失敗：', error);
    return {
      supported: false,
      error: '目前無法使用語音辨識，請改用打字。',
    };
  }
}

export function useSpeechInput({ onText, lang = 'zh-TW' }) {
  const initialState = useRef(null);
  if (initialState.current === null) initialState.current = getInitialState();

  const [supported] = useState(initialState.current.supported);
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState(initialState.current.error);

  const onTextRef = useRef(onText);
  const mountedRef = useRef(false);
  const listeningRef = useRef(false);
  const startingRef = useRef(false);
  const suppressResultsRef = useRef(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  useEffect(() => {
    mountedRef.current = true;
    if (!SpeechRecognitionModule) {
      return () => { mountedRef.current = false; };
    }

    const startSubscription = SpeechRecognitionModule.addListener('start', () => {
      if (!mountedRef.current) return;
      listeningRef.current = true;
      setListening(true);
      setError('');
    });

    const resultSubscription = SpeechRecognitionModule.addListener('result', (event) => {
      if (suppressResultsRef.current) return;
      const transcript = event.results?.[0]?.transcript?.trim() || '';
      if (!mountedRef.current) return;

      if (event.isFinal) {
        setInterim('');
        if (transcript) onTextRef.current(transcript);
      } else {
        setInterim(transcript);
      }
    });

    const errorSubscription = SpeechRecognitionModule.addListener('error', (event) => {
      if (!mountedRef.current || event.error === 'aborted') return;
      listeningRef.current = false;
      setListening(false);
      setInterim('');
      suppressResultsRef.current = true;
      setError(ERROR_MESSAGES[event.error] || FALLBACK_ERROR);
    });

    const endSubscription = SpeechRecognitionModule.addListener('end', () => {
      listeningRef.current = false;
      suppressResultsRef.current = false;
      if (!mountedRef.current) return;
      setListening(false);
      setInterim('');
    });

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      startSubscription.remove();
      resultSubscription.remove();
      errorSubscription.remove();
      endSubscription.remove();
      if (listeningRef.current) SpeechRecognitionModule.abort();
      listeningRef.current = false;
    };
  }, []);

  const start = useCallback(async () => {
    if (!SpeechRecognitionModule || !supported || startingRef.current || listeningRef.current) return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    startingRef.current = true;
    setStarting(true);
    setError('');
    setInterim('');

    try {
      const permission = await SpeechRecognitionModule.requestPermissionsAsync();
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      if (!permission.granted) {
        setError('麥克風或語音辨識權限未允許，請至裝置設定開啟後再試。');
        return;
      }

      if (!SpeechRecognitionModule.isRecognitionAvailable()) {
        setError('裝置目前沒有可用的語音辨識服務，請改用打字。');
        return;
      }

      suppressResultsRef.current = false;
      SpeechRecognitionModule.start({
        lang,
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        iosTaskHint: 'dictation',
      });
      listeningRef.current = true;
      setListening(true);
    } catch (startError) {
      console.error('啟動語音辨識失敗：', startError);
      if (mountedRef.current && requestIdRef.current === requestId) {
        setError(FALLBACK_ERROR);
      }
    } finally {
      if (mountedRef.current && requestIdRef.current === requestId) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  }, [lang, supported]);

  const stop = useCallback(() => {
    if (SpeechRecognitionModule && listeningRef.current) {
      SpeechRecognitionModule.stop();
    }
  }, []);

  const abort = useCallback(() => {
    requestIdRef.current += 1;
    startingRef.current = false;
    suppressResultsRef.current = true;
    if (mountedRef.current) {
      setStarting(false);
      setInterim('');
      setListening(false);
    }
    if (SpeechRecognitionModule && listeningRef.current) {
      listeningRef.current = false;
      SpeechRecognitionModule.abort();
    }
  }, []);

  return { supported, listening, starting, interim, error, start, stop, abort };
}
