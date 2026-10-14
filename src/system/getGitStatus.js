/**
 * @file Retrieves git repository information (hash, branch, repo name)
 */
const execSync = require('child_process').execSync

// git talks on stderr when it has nothing to report (`fatal: not a git repository` outside a
// checkout, `git: command not found` in a slim container). Both are normal for a deployed
// service, so the child's stderr is discarded and absence is detected from the exit status.
/**
 * Run a shell command and return its stdout.
 *
 * @param {string} command - shell command line
 * @returns {string} the command's standard output
 */
const exec = (command) => execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

const defaultGitValues = { hash:"", repo:"", branch:"" }
try{
  module.exports = {
    hash:exec('git rev-parse --short HEAD').trim(),
    repo:exec('url=$(git config --get remote.origin.url) && [ -n "$url" ] && basename -s .git "$url" || echo ""').trim(),
    branch:exec('git rev-parse --abbrev-ref HEAD').trim()
  };
}catch(err){
 // console.warn("Problem reading GIT",err)
 try{
  module.exports = __scribbles_gitStatus__
 }catch(err){
  module.exports = defaultGitValues
 }
}