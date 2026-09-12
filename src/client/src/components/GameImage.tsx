import React, { useState, useEffect } from 'react';
import { Gamepad2 } from 'lucide-react';
import { getGameCoverCandidates, getSteamCapsuleUrl } from '../utils/steamImages.js';

interface GameImageProps {
  game: {
    steamAppId: number;
    title: string;
    headerImage?: string;
    capsuleImage?: string;
    iconUrl?: string;
  };
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  type?: 'header' | 'capsule';
}

export function GameImage({
  game,
  alt = '',
  className = '',
  style,
  type = 'header'
}: GameImageProps) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [hasFailedAll, setHasFailedAll] = useState(false);

  // Generate candidate list based on desired display type
  const candidates = React.useMemo(() => {
    if (type === 'capsule') {
      const urls: string[] = [];
      if (game.iconUrl && !game.iconUrl.includes('cdn.akamai.')) {
        urls.push(game.iconUrl);
      }
      if (game.capsuleImage && !game.capsuleImage.includes('cdn.akamai.')) {
        urls.push(game.capsuleImage);
      }
      if (game.steamAppId > 0) {
        urls.push(getSteamCapsuleUrl(game.steamAppId, 'small'));
        urls.push(getSteamCapsuleUrl(game.steamAppId, 'medium'));
        urls.push(getGameCoverCandidates(game)[0] || '');
      }
      return urls.filter(Boolean);
    }
    return getGameCoverCandidates(game);
  }, [game.steamAppId, game.headerImage, game.capsuleImage, game.iconUrl, type]);

  // Reset state whenever the game changes to avoid state/image bleed between games
  useEffect(() => {
    setCandidateIndex(0);
    setHasFailedAll(false);
  }, [game.steamAppId]);

  const currentSrc = candidates[candidateIndex];

  const handleError = () => {
    if (candidateIndex + 1 < candidates.length) {
      setCandidateIndex(prev => prev + 1);
    } else {
      setHasFailedAll(true);
    }
  };

  if (hasFailedAll || !currentSrc) {
    return (
      <div 
        className={className}
        style={{ 
          display: 'flex', 
          flexDirection: 'column',
          alignItems: 'center', 
          justifyContent: 'center', 
          background: 'linear-gradient(135deg, var(--surface-hover) 0%, var(--surface) 100%)',
          color: 'var(--dim)',
          gap: 4,
          overflow: 'hidden',
          ...style 
        }}
      >
        <Gamepad2 size={20} style={{ opacity: 0.6 }} />
        <span style={{ 
          fontSize: '0.68rem', 
          fontWeight: 600, 
          padding: '0 6px', 
          textAlign: 'center', 
          overflow: 'hidden', 
          textOverflow: 'ellipsis', 
          whiteSpace: 'nowrap', 
          maxWidth: '90%' 
        }}>
          {game.title}
        </span>
      </div>
    );
  }

  return (
    <img
      key={`${game.steamAppId}-${candidateIndex}`}
      src={currentSrc}
      alt={alt || game.title}
      className={className}
      style={style}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={handleError}
    />
  );
}
