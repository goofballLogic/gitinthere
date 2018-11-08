const fetch = require( "node-fetch" );

async function main() {

    const resp = await fetch( "https://api.github.com/repos/fluenttechnology/reviewers/pulls" );
    const json = await resp.json();
    console.log( json );

}

main();