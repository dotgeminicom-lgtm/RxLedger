import React, { useState } from 'react';
import { Check, Copy, ExternalLink, MessageCircle, Share2, X } from 'lucide-react';

interface WhatsAppShareModalProps {
  isOpen: boolean;
  formattedText: string;
  onClose: () => void;
}

export const WhatsAppShareModal: React.FC<WhatsAppShareModalProps> = ({
  isOpen,
  formattedText,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);

  if (!isOpen) return null;

  const encodedText = encodeURIComponent(formattedText);
  const waWebHref = `https://wa.me/?text=${encodedText}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setShareNote('Clipboard permission blocked. Select and copy the text box manually.');
    }
  };

  const isAdvice =
    formattedText.includes('PATIENT MEDICATION ADVICE') ||
    formattedText.includes('PATIENT ADVICE') ||
    formattedText.includes('PATIENT COUNSELLING');

  const handleSystemShare = async () => {
    setShareNote(null);
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: isAdvice ? 'Patient Medication Advice' : 'Pharmacy Prescription Record',
          text: formattedText,
        });
        setShareNote(
          'Share sheet opened. Confirm your Pharmacy WhatsApp Group inside WhatsApp and tap Send.'
        );
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setShareNote(
            'System share could not open automatically. Use "Open WhatsApp" or "Copy Record" below to paste into your group.'
          );
        }
      }
    } else {
      setShareNote(
        'Native share sheet is unavailable on this browser. Tap "Open WhatsApp" below to pick your group and send manually.'
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isAdvice ? 'Share Patient Counselling to WhatsApp' : 'Share Prescription Record to WhatsApp'}
    >
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mt-3 sm:hidden" />
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <MessageCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {isAdvice ? 'Share Patient Counselling Advice' : 'Share to WhatsApp Group'}
              </h2>
              <p className="text-xs text-slate-500">
                {isAdvice
                  ? 'Select patient or pharmacy WhatsApp chat and confirm sending'
                  : 'Choose your WhatsApp group and confirm sending'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100"
            aria-label="Close WhatsApp share"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-600">WhatsApp Message Preview</span>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800 px-2.5 py-1 rounded-lg bg-emerald-50"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy Text'}
              </button>
            </div>
            <pre
              className={`whitespace-pre-wrap text-xs text-slate-800 leading-relaxed select-all ${
                isAdvice ? 'font-sans' : 'font-mono'
              }`}
            >
              {formattedText}
            </pre>
          </div>

          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 text-xs text-emerald-900 leading-relaxed">
            <p className="font-semibold mb-1">How WhatsApp Sharing Works</p>
            <p>
              Tap <strong>Share via System Sheet</strong> (recommended on Android) or{' '}
              <strong>Open WhatsApp</strong>, select your{' '}
              {isAdvice ? 'patient or pharmacy group chat' : 'Pharmacy WhatsApp Group'}, review the
              pre-filled message, and tap Send in WhatsApp to confirm.
            </p>
          </div>

          {shareNote && (
            <p className="text-xs text-slate-700 bg-slate-100 border border-slate-200 rounded-xl px-3.5 py-2.5">
              {shareNote}
            </p>
          )}
        </div>

        <div className="p-5 bg-slate-50 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-2.5 pb-safe">
          <button
            type="button"
            onClick={handleSystemShare}
            className="min-h-[46px] px-4 py-2.5 rounded-xl bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 inline-flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <Share2 className="w-4 h-4" />
            Share via System Sheet
          </button>

          <a
            href={waWebHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              setShareNote(
                'WhatsApp opened in a new tab/app. Select your contact or group and tap Send to confirm.'
              )
            }
            className="min-h-[46px] px-4 py-2.5 rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] border border-[#1da851] text-slate-950 text-sm font-bold inline-flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <ExternalLink className="w-4 h-4" />
            Open WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
};
