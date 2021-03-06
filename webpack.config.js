var path = require('path')

module.exports = {
  entry: './src/index.js',
  target: 'web',
  devtool: 'source-map',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'akasha-id-client.js',
    library: 'AKASHAidClient',
    libraryTarget: 'umd',
    umdNamedDefine: true
  },
  node: {
    fs: 'empty'
  }
}
