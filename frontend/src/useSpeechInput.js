// src/useSpeechInput.js
//
// 語音輸入：瀏覽器內建的 Web Speech API，不裝套件、不經過我們的後端。
//
// 辨識結果只交給 onText，由呼叫端放進輸入框，**不自動送出** ——
// 使用者確認辨識出來的字沒錯再按送出，走的仍是原本的 /diagnose，
// 不會多出一條繞過 Safety Pipeline 的路徑。
//
// 注意：Chrome 的實作會把聲音送到 Google 的伺服器辨識。
// Firefox 沒有實作，supported 會是 false，呼叫端應該隱藏按鈕。
//
// ponytail: 一次說一段（continuous = false），停頓後自動結束。
//   長輩不必記得「再按一次停止」；要補充就再按一次。

import { useCallback, useEffect, useRef, useState } from 'react';

const SpeechRecognitionImpl =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : undefined;


const ERROR_MESSAGES = {
  'not-allowed': '麥克風權限被拒絕，請在瀏覽器設定允許麥克風，或改用打字。',
  'service-not-allowed': '這個瀏覽器不允許語音輸入，請改用打字。',
  'no-speech': '沒有聽到聲音，請靠近麥克風再試一次。',
  'audio-capture': '找不到麥克風，請確認裝置後再試，或改用打字。',
  network: '語音辨識需要網路連線，請確認網路後再試，或改用打字。',
};

const FALLBACK_ERROR = '語音辨識失敗，請再試一次或改用打字。';


export function useSpeechInput({ onText, lang = 'zh-TW' }) {

  const [listening, setListening] = useState(false);

  // 還在辨識中、尚未定案的文字，只拿來顯示，不放進輸入框
  const [interim, setInterim] = useState('');

  const [error, setError] = useState('');

  const recognitionRef = useRef(null);

  // onText 每次 render 都是新函式；用 ref 拿最新的，
  // 才不會讓辨識進行到一半時呼叫到舊的 closure。
  const onTextRef = useRef(onText);

  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);


  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);


  const start = useCallback(() => {

    if (!SpeechRecognitionImpl || recognitionRef.current) {
      return;
    }

    const recognition = new SpeechRecognitionImpl();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {

      let finalText = '';
      let interimText = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];

        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }

      setInterim(interimText);

      if (finalText.trim()) {
        onTextRef.current(finalText.trim());
      }
    };

    recognition.onerror = (event) => {
      // aborted 是我們自己呼叫 abort()（例如離開頁面），不算錯誤
      if (event.error !== 'aborted') {
        setError(ERROR_MESSAGES[event.error] || FALLBACK_ERROR);
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      setInterim('');
    };

    setError('');

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setListening(true);
    } catch {
      setError(FALLBACK_ERROR);
    }
  }, [lang]);


  // 元件卸載時中止，避免麥克風一直開著
  useEffect(() => () => recognitionRef.current?.abort(), []);


  return {
    supported: Boolean(SpeechRecognitionImpl),
    listening,
    interim,
    error,
    start,
    stop,
  };
}
