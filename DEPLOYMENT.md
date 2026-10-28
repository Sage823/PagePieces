# Deploy Paper Pieces

This is a static Vite site. Cloudflare Pages, Netlify, and Vercel can host it for free.

## Before deploying

Run the production build locally:

```powershell
npm install
npm run build
npm run preview
```

The production files are generated in `dist/`.

The app has no backend or API keys. Background removal uses a model loaded from a public CDN, so the deployed site needs normal internet access.

## Option A: Cloudflare Pages without GitHub

This is the shortest route.

1. Sign in:

```powershell
npx wrangler login
```

2. Create the Pages project once:

```powershell
npx wrangler pages project create paper-pieces --production-branch main
```

3. Build and deploy:

```powershell
npm run build
npx wrangler pages deploy dist --project-name paper-pieces
```

Cloudflare will print a `*.pages.dev` URL. To deploy later, run the last two commands again.

## Option B: GitHub + Cloudflare Pages

This gives you automatic deployment every time you push to GitHub.

### 1. Put the project on GitHub

Create a new empty repository on GitHub named `paper-pieces`. Do not add a README, license, or `.gitignore` during repository creation.

In this project directory, run:

```powershell
git init
git add .
git commit -m "Initial Paper Pieces build"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/paper-pieces.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

If Git asks for your name and email:

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

If you have the GitHub CLI installed, you can do steps 1 in one command instead:

```powershell
gh auth login
gh repo create paper-pieces --public --source=. --remote=origin --push
```

### 2. Connect GitHub to Cloudflare Pages

1. Open <https://dash.cloudflare.com/>.
2. Go to **Workers & Pages**.
3. Choose **Create application** → **Pages** → **Connect to Git**.
4. Authorize GitHub and select the `paper-pieces` repository.
5. Use these settings:

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
Production branch: main
```

6. Add an environment variable to ensure a compatible Node version:

```text
NODE_VERSION=22
```

7. Click **Save and Deploy**.

Every future push to `main` will trigger a new deployment:

```powershell
git add .
git commit -m "Update notebook"
git push
```

## Other free hosts

### Netlify

Install the CLI, deploy, and follow the browser login prompt:

```powershell
npx netlify-cli deploy --prod --dir=dist
```

Build command: `npm run build`  
Publish directory: `dist`

You can also drag the generated `dist` folder into Netlify Drop.

### Vercel

Install the CLI, deploy, and follow the browser login prompt:

```powershell
npm install -g vercel
vercel
vercel --prod
```

Vercel should detect Vite automatically. If asked, use `npm run build` and `dist`.

## Important: local data is per domain

Pages and settings are stored in the browser's IndexedDB, not on a server. Data created at `http://localhost:4173` will not automatically appear after deploying to `https://something.pages.dev`, because they are different origins.

After choosing a production URL, use that same URL consistently. Clearing site data, using private browsing, or switching domains will make the browser appear empty.
