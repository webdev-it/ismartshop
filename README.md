# iSmartStore Frontend (Web Prototype)

This folder contains a static HTML/CSS/JS prototype that reproduces the mobile UI from the provided screenshot.

Files
- `index.html` — main page (mobile layout)
- `styles.css` — styles to match the screenshot
- `script.js` — injects product cards and handles carousel; attempts to fetch `/api/products` and falls back to local sample data

How it works
- Products are expected to be served from `/api/products` (JSON). For now `script.js` falls back to sample data.

Run locally
- Open `index.html` in the browser (recommended to use a local static server for fetch to work):

```powershell
cd frontend
# if you have npm installed, install serve once
npm install -g serve
serve . -p 3000
# then open http://localhost:3000 in a mobile-width browser or device emulator
```

- Alternatively use the VS Code Live Server extension.

Next steps I can do
- Polish visuals to match the screenshot exactly (blurred background, refined shadows, typography tweaks).
- Add a small JSON mock endpoint and a tiny Node dev server so the frontend fetches real endpoints.
- Implement admin panel and then the Node.js backend API.

Tell me which next step you'd like and I will implement it (e.g., add mock API server, refine visuals, or integrate real backend later).