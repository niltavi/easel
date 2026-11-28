# Install Easel

Easel is an offline-first whiteboard. It stores each drawing in the browser until the user enables account sync for it.

1. Confirm the host and access scope with the operator. For a private install, keep the published port on loopback unless the operator requests wider access.
2. Clone [niltavi/easel](https://github.com/niltavi/easel) and follow the [Docker deployment guide](deploy.md). Keep SQLite on a named volume. Retain that volume when updating the image.
3. Open the instance in a browser and choose **Open whiteboard**. Draw a shape, reload, and confirm the drawing is still present. For a sync check, use a disposable account in an authorized test instance, enable sync for the drawing, and open it from a separate browser context.
4. Report the instance URL, the image revision, and which workflows you verified. The private self-hosted login mode uses email and password without email delivery. Configure SMTP for an email-code instance. AI needs provider credentials.

See the [repository guidance](../../AGENTS.md) before proposing source changes.
