import React, { useEffect } from 'react';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';

const DISCORD_INVITE_URL = 'https://discord.com/invite/ATXQqX8g8F';

export default function DiscordRedirectPage(): React.ReactElement {
    useEffect(() => {
        if (typeof window !== 'undefined') {
            window.location.replace(DISCORD_INVITE_URL);
        }
    }, []);

    return (
        <Layout title="Redirecting to Discord">
            <Head>
                <meta httpEquiv="refresh" content={`0; url=${DISCORD_INVITE_URL}`} />
                <link rel="canonical" href={DISCORD_INVITE_URL} />
            </Head>
            <main style={{ padding: '2rem 1rem', textAlign: 'center' }}>
                <p>Redirecting to Discord...</p>
                <p>
                    If you are not redirected, open{' '}
                    <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
                        this invite link
                    </a>
                    .
                </p>
            </main>
        </Layout>
    );
}
