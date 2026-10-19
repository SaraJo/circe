import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

const releasesUrl = 'https://github.com/SaraJo/circe/releases';

const features = [
  {
    title: 'Keep separate tasks in view',
    body: 'Put one agent on trip planning, another on research, and another on everyday logistics, each in its own tile beside your notes, browser, or editor.',
  },
  {
    title: 'Make room for ongoing work',
    body: 'Use separate conversation tabs, switch tabs while an agent is thinking, and hand off to a fresh conversation when a chat gets too long.',
  },
  {
    title: 'Respond where work happens',
    body: "Review tool approval requests in the agent's tile: allow once, for the session, or YOLO the task until it finishes.",
  },
  {
    title: "Share what you're looking at",
    body: 'Attach an image to a conversation when your Hermes agent and model support image input.',
  },
];

export default function Home(): ReactNode {
  return (
    <Layout
      title="Your agent crew, at home on your desktop"
      description="Circe brings your Hermes AI agents onto your desktop as individual chat windows.">
      <header className={styles.hero}>
        <div className="container">
          <img
            className={styles.heroImage}
            src={useBaseUrl('/img/synced/circe-header.png')}
            alt="Circe — a pixel-art crew in desktop conversation windows"
          />
          <p className={styles.tagline}>Your agent crew, at home on your desktop.</p>
          <div className={styles.buttons}>
            <Link className="button button--primary button--lg" href={releasesUrl}>
              Download the beta
            </Link>
            <Link className="button button--secondary button--lg" to="/docs/install">
              Install guide
            </Link>
          </div>
          <p className={styles.note}>
            macOS (Apple Silicon) and Windows 10/11 x64 (experimental). Requires Hermes and a
            connected model provider. Builds are unsigned.
          </p>
        </div>
      </header>
      <main>
        <section className="container margin-vert--xl">
          <img
            className={styles.demo}
            src={useBaseUrl('/img/synced/circe-demo.gif')}
            alt="Circe agent conversations beside a document, showing a packing request and the completed list."
          />
        </section>
        <section className="container margin-bottom--xl">
          <Heading as="h2" className="text--center margin-bottom--lg">
            A crew you recognize
          </Heading>
          <div className={styles.features}>
            {features.map((feature) => (
              <div key={feature.title} className={styles.feature}>
                <Heading as="h3">{feature.title}</Heading>
                <p>{feature.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </Layout>
  );
}
