import path from 'path';
import cssInjectedByJsPlugin from 'vite-plugin-css-injected-by-js';

function padTimePart(value) {
  return String(value).padStart(2, '0');
}

function createBuildTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = padTimePart(now.getMonth() + 1);
  const day = padTimePart(now.getDate());
  const hours = padTimePart(now.getHours());
  const minutes = padTimePart(now.getMinutes());
  const seconds = padTimePart(now.getSeconds());
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export default {
  define: {
    __UNIVER_DATASOURCE_ENTRY_BUILD_VERSION__: JSON.stringify(createBuildTimestamp())
  },
  build: {
    copyPublicDir: false,
    lib: {
      entry: path.resolve(__dirname, 'src', 'index.js'),
      name: 'UniverDatasourceEntryTool',
      fileName: 'univerDatasourceEntry'
    }
  },
  plugins: [cssInjectedByJsPlugin()]
};
