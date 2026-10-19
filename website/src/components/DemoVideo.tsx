import {useEffect, useRef, useState, type ReactNode} from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';

const description =
  'Circe agent conversations beside a document, showing a packing request and the completed list.';

// Plays the demo like the README's GIF (muted, looping, inline) from the
// MP4, which is sharper, smoother, and about a seventh of the GIF's size.
export default function DemoVideo({className}: {className?: string}): ReactNode {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      videoRef.current?.pause();
      setReducedMotion(true);
    }
  }, []);

  return (
    <video
      ref={videoRef}
      className={className}
      src={useBaseUrl('/img/synced/circe-demo.mp4')}
      poster={useBaseUrl('/img/circe-demo-poster.jpg')}
      width={1210}
      height={740}
      autoPlay={!reducedMotion}
      controls={reducedMotion}
      muted
      loop
      playsInline
      preload="auto"
      aria-label={description}
      style={{display: 'block', width: '100%', height: 'auto', borderRadius: 12}}>
      {description}
    </video>
  );
}
