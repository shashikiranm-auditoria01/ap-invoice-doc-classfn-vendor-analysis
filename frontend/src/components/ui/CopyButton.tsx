import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CopyButtonProps {
  text: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function CopyButton({ text, className = '', size = 'md' }: CopyButtonProps) {
  const sizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`
        p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600
        transition-colors
        ${className}
      `}
      title={copied ? 'Copied!' : 'Copy to clipboard'}
    >
      {copied ? (
        <Check className={`${sizeClasses[size]} text-green-500`} />
      ) : (
        <Copy className={sizeClasses[size]} />
      )}
    </button>
  );
}

interface CopyableTextProps {
  text: string;
  truncate?: boolean;
  maxLength?: number;
  className?: string;
}

export function CopyableText({
  text,
  truncate = true,
  maxLength = 20,
  className = '',
}: CopyableTextProps) {
  const displayText = truncate && text.length > maxLength
    ? `${text.substring(0, maxLength)}...`
    : text;

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <span className="font-mono text-sm" title={text}>
        {displayText}
      </span>
      <CopyButton text={text} />
    </div>
  );
}
