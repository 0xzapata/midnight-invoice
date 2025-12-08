# Contributing to Midnight Invoice

Thank you for your interest in contributing to Midnight Invoice! We welcome contributions from the community.

## Getting Started

1.  **Fork the repository** on GitHub.
2.  **Clone your fork** locally:
    ```bash
    git clone https://github.com/0xzapata/midnight-invoice.git
    cd midnight-invoice
    ```
3.  **Install dependencies** using Bun (recommended) or Node.js:
    ```bash
    bun install
    ```

## Development

Start the development server:

```bash
bun dev
```

The app will be available at `http://localhost:5173`.

## submitting Changes

1.  Create a new branch for your feature or bugfix:
    ```bash
    git checkout -b feature/my-new-feature
    ```
2.  Make your changes and commit them with clear, descriptive messages.
3.  Run tests to ensure everything is working:
    ```bash
    bun run test
    ```
4.  Run the linter:
    ```bash
    bun run lint
    ```
5.  Push your branch to your fork:
    ```bash
    git push origin feature/my-new-feature
    ```
6.  Open a **Pull Request** on the main repository.

## Code Style

- We use **TypeScript** for type safety.
- We use **Tailwind CSS** for styling.
- We use **shadcn/ui** for UI components.
- Please follow the existing code style and formatting (Prettier/ESLint).

## Reporting Issues

If you find a bug or have a feature request, please open an issue on GitHub.
