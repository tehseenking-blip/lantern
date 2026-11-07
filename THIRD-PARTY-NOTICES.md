# Third-party notices

Lantern is distributed under the MIT licence. It bundles or depends on the
following packages, each under its own licence. All of them are installed from
npm by you; nothing is fetched at runtime.

| Package | Purpose | Licence |
| --- | --- | --- |
| electron | Desktop application runtime | MIT |
| react, react-dom | Interface | MIT |
| react-markdown, remark-gfm | Markdown, tables and code rendering | MIT |
| better-sqlite3 | Local SQLite database | MIT |
| mammoth | `.docx` text extraction | BSD-2-Clause |
| pdf-parse | `.pdf` text extraction | MIT |
| vite, @vitejs/plugin-react | Interface build | MIT |
| electron-builder | Windows installer build | MIT |
| @electron/rebuild | Rebuilds the database engine for the desktop runtime | MIT |

## Language models

No model files are included, downloaded, copied or modified by this
application. Models you use are licensed by their authors, and their terms
still apply to what you generate with them. Commercial use of some model
weights is restricted — check the licence of each model you install.

## Document formats

Attachment text extraction is performed locally. PDF and Word support comes
from the libraries above; any other format is refused with a clear message
instead of being uploaded anywhere.