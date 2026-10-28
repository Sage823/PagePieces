# Paper Pieces

**A quiet, local-first scrapbook for the web.**

https://pagepieces.rguoan.workers.dev/

Paper Pieces is a minimal infinite canvas for arranging images and text into simple pages. It runs entirely in your browser, with no account, backend, or upload required.

## Features

- Local-first pages stored in the browser
- Drag-and-drop or file-picker image import
- On-device background removal
- Resizable images and text
- Pixel, serif, sans, and Times typography
- Infinite canvas with PNG export

## Quick start

```bash
npm install
npm run dev
```

Create a production build with:

```bash
npm run build
```

## Deployment

See the [deployment guide](./DEPLOYMENT.md) for Cloudflare, GitHub, Netlify, and Vercel instructions.

## Credits

Background removal is powered by [`@imgly/background-removal`](https://github.com/imgly/background-removal-js), which uses the IS-Net model.

If you reference the segmentation model in academic work, cite:

```bibtex
@InProceedings{qin2022,
  author = {Xuebin Qin and Hang Dai and Xiaobin Hu and Deng-Ping Fan and Ling Shao and Luc Van Gool},
  title = {Highly Accurate Dichotomous Image Segmentation},
  booktitle = {ECCV},
  year = {2022}
}
```

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for licenses and sources.

## License

AGPL-3.0-only. See [LICENSE](./LICENSE).
