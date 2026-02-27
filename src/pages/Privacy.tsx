const Privacy = () => {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground">Last updated: February 27, 2026</p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">1. Data We Collect</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          We collect the fitness and wellness data you upload or sync (activities, sleep, daily metrics), your profile information (name, training goals, experience level), and authentication credentials (email address).
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">2. How We Use Your Data</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Your data is used solely to provide personalised training insights, generate training plans, and display your fitness analytics within the app. We do not sell or share your data with third parties.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">3. Third-Party Integrations</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          When you connect services like Strava or Google Fit, we access only the data necessary to sync your activities and wellness metrics. You can disconnect these integrations at any time from the Settings page.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">4. Data Storage & Security</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          All data is stored securely with encryption at rest and in transit. Access is restricted to your authenticated account only.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">5. Data Deletion</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          You may request deletion of your account and all associated data at any time by contacting us or through the Settings page.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">6. Contact</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          If you have questions about this privacy policy, please reach out through the app's support channels.
        </p>
      </section>
    </div>
  );
};

export default Privacy;
