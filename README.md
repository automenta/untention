# notention5

notention5 is a Nostr client that allows users to send and receive public and private messages, create and join groups, and take notes.

## Features

-   **Nostr Client**: Connect to the Nostr network to send and receive messages.
-   **Public/Private Messages**: Send public messages to all users or private messages to specific users.
-   **Groups**: Create and join encrypted groups to communicate with multiple users at once.
-   **Notes**: Take notes and store them locally.
-   **Progressive Web App (PWA)**: Installable on desktop and mobile, offering an app-like experience and offline capabilities.

## Setup and Run

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/notention5.git
    cd notention5
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Run the development server:**
    ```bash
    npm run dev
    ```
    This will start the Vite development server and open the application in your default browser with Hot Module Replacement (HMR).

## Development Scripts

Here are the essential scripts for development and building:

-   `npm run dev`: Starts the Vite development server with HMR. Your primary command for local development.
-   `npm run build`: Compiles and bundles the application for production. The output will be in the `dist/` directory.
-   `npm run preview`: Serves the production build locally. Useful for testing the optimized build before deployment.
-   `npm run test:unit`: Runs unit tests using Vitest.
-   `npm run test:e2e`: Runs end-to-end tests using Playwright.
-   `npm run test`: Runs both unit and end-to-end tests.
-   `npm run test:coverage`: Runs unit tests and generates a code coverage report.
-   `npm run lint`: Runs ESLint to check for code quality and style issues.
-   `npm run format`: Runs Prettier to automatically format your code according to defined style rules.
-   `npm run clean`: Removes build artifacts (`dist/`, `.vite/`) and test reports (`coverage/`).
-   `npm run security:audit`: Runs `npm audit` to check for security vulnerabilities in dependencies.
-   `npm run build:analyze`: Performs a production build and then generates an interactive bundle size report (`dist/bundle-report.html`), helping identify large dependencies.
-   `npm run prepare`: Sets up Husky Git hooks (automatically run after `npm install`).

## Basic Usage

1.  **Manage Identity:**
    -   When you first open the application, if no identity is found, you will be prompted to generate a new Nostr private key or load an existing one. This key is your identity on the Nostr network.
2.  **Connect to Nostr:**
    -   Once your identity is set up, you can connect to the Nostr network by adding relays in the settings.
3.  **Send Messages:**
    -   Navigate to the "Messages" section to send public or private messages.
4.  **Create/Join Groups:**
    -   Explore the "Groups" section to create a new encrypted group or join an existing one using its ID and secret key.
5.  **Take Notes:**
    -   Use the "Notes" section to create and manage your personal notes, stored locally.

## Contributing

Contributions are welcome! Please ensure your code adheres to the project's linting and formatting standards (`npm run lint` and `npm run format`). Feel free to submit a pull request or open an issue if you find any bugs or have any suggestions.
