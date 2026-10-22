import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import DemoVideo from '@site/src/components/DemoVideo';

import styles from './index.module.css';

const releasesUrl = 'https://github.com/SaraJo/circe/releases';
const hermesUrl = 'https://hermes-agent.nousresearch.com';

const capabilities = [
  {
    title: 'Separate tasks, separate tiles',
    body: 'One agent on trip planning, another on research, another on everyday logistics, each beside the app you are working in.',
  },
  {
    title: 'Room for long-running work',
    body: 'Conversation tabs, switching while an agent thinks, and a clean handoff to a fresh chat when the context fills up.',
  },
  {
    title: 'Approvals in the tile',
    body: 'Allow an action once, for the session, or YOLO the task until it finishes or you send a new message.',
  },
  {
    title: 'Show, not just tell',
    body: 'Attach an image to a conversation when your Hermes agent and model support image input.',
  },
];

const steps = [
  {
    title: 'Set up Hermes',
    body: (
      <>
        Install <Link href={hermesUrl}>Hermes</Link> and connect a model provider.
      </>
    ),
  },
  {
    title: 'Install Circe',
    body: (
      <>
        Grab the beta for macOS or Windows and follow the{' '}
        <Link to="/docs/install">install guide</Link>.
      </>
    ),
  },
  {
    title: 'Meet your crew',
    body: 'Pick a fandom for new agents or adopt the ones you already have.',
  },
];

function Hero(): ReactNode {
  return (
    <header className={styles.hero}>
      <div className={clsx('container', styles.heroGrid)}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            <span className={styles.eyebrowDot} />
            Beta for macOS and Windows
          </p>
          <Heading as="h1" className={styles.heroTitle}>
            Your agent crew, <span className={styles.gradientText}>at home</span> on your desktop.
          </Heading>
          <p className={styles.heroLead}>
            Circe gives each of your Hermes agents its own chat window, with a name, a
            pixel-art face, and colours you choose. Their work stays in view while you get on
            with yours.
          </p>
          <div className={styles.heroActions}>
            <Link className="button button--primary button--lg" href={releasesUrl}>
              Download the beta
            </Link>
            <Link className={styles.textLink} to="/docs/install">
              Read the install guide <span aria-hidden="true">→</span>
            </Link>
          </div>
          <p className={styles.heroNote}>
            Requires Hermes and a connected model provider. Builds are unsigned.
          </p>
        </div>
        <div className={styles.heroMedia}>
          <div className={styles.window}>
            <div className={styles.windowBar} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <DemoVideo />
          </div>
        </div>
      </div>
    </header>
  );
}

function Showcase(): ReactNode {
  return (
    <section className={styles.showcase}>
      <div className={clsx('container', styles.row)}>
        <div className={styles.rowCopy}>
          <p className={styles.kicker}>A crew you recognize</p>
          <Heading as="h2" className={styles.sectionTitle}>
            Give every agent a face and a place on screen.
          </Heading>
          <p>
            Choose a favourite fandom, universe, or community and Circe suggests names,
            portraits, and colours for your agents. Keep the ones you like and change the rest.
            Agents you leave out stay untouched in Hermes.
          </p>
          <Link className={styles.textLink} to="/docs/onboarding">
            How onboarding works <span aria-hidden="true">→</span>
          </Link>
        </div>
        <img
          className={styles.shot}
          src={useBaseUrl('/img/circe-desktop.jpg')}
          width={1600}
          height={976}
          loading="lazy"
          alt="Circe agent tiles arranged around an Apple Notes packing checklist, with a tool approval request visible in Scully's tile."
        />
      </div>

      <div className={clsx('container', styles.row, styles.rowReverse)}>
        <div className={styles.rowCopy}>
          <p className={styles.kicker}>Built for ongoing work</p>
          <Heading as="h2" className={styles.sectionTitle}>
            Everything a conversation needs, in one tile.
          </Heading>
          <ul className={styles.capabilities}>
            {capabilities.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.body}</span>
              </li>
            ))}
          </ul>
        </div>
        <img
          className={styles.shot}
          src={useBaseUrl('/img/circe-tile-closeup.jpg')}
          width={929}
          height={500}
          loading="lazy"
          alt="Scully and Mulder's Circe tiles side by side, with pixel-art avatars, conversation tabs, context meters, and image attachment buttons."
        />
      </div>
    </section>
  );
}

function GetStarted(): ReactNode {
  return (
    <section className={clsx('container', styles.startWrap)}>
      <div className={styles.start}>
        <div className={styles.startHead}>
          <Heading as="h2" className={styles.sectionTitle}>
            Up and running in three steps.
          </Heading>
          <p>
            Hermes supplies the models, tools, and integrations. Circe gives your crew a
            visible home.
          </p>
        </div>
        <ol className={styles.steps}>
          {steps.map((step, index) => (
            <li key={step.title}>
              <span className={styles.stepNumber}>{String(index + 1).padStart(2, '0')}</span>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
        <div className={styles.startActions}>
          <Link className="button button--primary button--lg" href={releasesUrl}>
            Download the beta
          </Link>
          <Link className={styles.textLink} to="/docs/release-notes">
            See what's new <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="Your agent crew, at home on your desktop"
      description="Circe brings your Hermes AI agents onto your desktop as individual chat windows.">
      <Hero />
      <main>
        <Showcase />
        <GetStarted />
      </main>
    </Layout>
  );
}
