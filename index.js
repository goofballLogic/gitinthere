const fetch = require( "node-fetch" );
const read = require( "read" );
const fs = require( "fs" );
const path = require( "path" );
const { fromJSON } = require( "./csv" );

const readLineWithOptions = async options => new Promise( ( resolve, reject ) => read( options, ( err, data ) => err ? reject( err ) : resolve( data ) ) );
const readLine = async prompt => await readLineWithOptions( { prompt } );
const readLineHidden = async prompt => await readLineWithOptions( { prompt, replace: "*", silent: true } );

async function auth() {

    const username = await readLine( "Username: " );
    const password = await readLineHidden( "Password: " );
    const authorization = Buffer.from( `${username}:${password}` ).toString( "base64" );
    return `Basic ${authorization}`;

}

let promisedAuth = auth();

async function get( url ) {

    const auth = await promisedAuth;
console.log( url );
    const resp = await fetch( url, { headers: { "Authorization": auth } } );
    const status = resp.status;
    if ( resp.status > 299 ) {

        console.log( resp );
        return { status };

    }
    const contentTypes = ( resp.headers.get( "content-type" ) || "" ).split( "," ).filter( x => x ).map( t => t.split( ";" )[ 0 ] );
    const links = ( resp.headers.get( "link" ) || "" ).split( "," ).filter( x => x ).map( x => x.split( ";" ) ).reduce( ( index, [ url, rel ] ) => ( {
        ...index,
        [ rel.match( /\"([^"]*)/ )[ 1 ] ]: url.match( /\<([^>]*)/ )[ 1 ]

    } ), {} );
    const body = contentTypes.includes( "application/json" ) ? await resp.json() : await resp.text();

    return { status, links, body };

}

async function getAll( url, needMore ) {

    const fetched = await get( url );
    if ( typeof fetched.body !== "object" ) {

        console.log( fetched );
        throw new Error( "Can't get any more" );

    }
    return ( needMore( fetched ) && fetched.links.next )
        ? [ fetched, ...await getAll( fetched.links.next, needMore ) ]
        : [ fetched ];

}

async function getPull( pull ) {

    const fetched = await getAll( pull.url + "/reviews", () => true );
    const reviews = fetched
        .reduce( ( all, x ) => all.concat( x.body ), [] )
        .map( x => ( {

            user: x.user.login,
            state: x.state,
            submitted: x.submitted_at

        } ) );
    const approval = reviews.find( review => review.state === "APPROVED" );
    return { ...pull, reviews, approval };

}

function chunk( arr, n ) {

    var ret = [];
    for( var i = 0; i < arr.length; i+= n ) {

        ret.push( arr.slice( i, i + n ) );

    }
    return ret;

}

async function getPulls( needMore ) {

    needMore = needMore || ( () => true );
    const url = "https://api.github.com/repos/fluenttechnology/reviewers/pulls?state=all";
    const fetched = await getAll( url, needMore );
    const allFetched = fetched
        .reduce( ( all, x ) => all.concat( x.body ), [] )
        .map( x => ( {

            url: x.url,
            created: x.created_at,
            closed: x.closed_at,
            reviewers: x.requested_reviewers.map( x => x.login )

        } ) );
    let ret = [];
    // don't overload github's API
    for( var some of chunk( allFetched, 15 ) ) {

        var pulls = await Promise.all( some.map( getPull ) );
        ret = ret.concat( pulls );

    }
    return ret;

}

const startOf = dt => new Date( Date.UTC( dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() ) );

async function main() {

    const pulls = await getPulls( fetched => true || false && new Date( fetched.body.reverse()[ 0 ].created_at ) > new Date( 2000, 0 ) );
    console.log( pulls.length );
    fs.writeFileSync( path.resolve( __dirname, "output.json" ), JSON.stringify( pulls, null, 1 ) );


    const aggregates = pulls.reduce( ( analysis, pull ) => ( {

        reviewers: [ ...analysis.reviewers, pull.approval && pull.approval.user ],
        start: pull.created < analysis.start ? pull.created : analysis.start,
        end: pull.created > analysis.end ? pull.created : analysis.end

    } ), { reviewers: [], start: "3000", end: "0" } );
    aggregates.start = new Date( aggregates.start );
    aggregates.end = new Date( aggregates.end );
    aggregates.reviewers = Array.from( new Set( aggregates.reviewers ) ).filter( x => x );

    const dayIndex = {};
    var x = startOf( aggregates.start );
    while( x < aggregates.end ) {

        dayIndex[ x.toISOString().slice( 0, 10 ) ] = [];
        x.setUTCDate( x.getUTCDate() + 1 );

    }
    for( var pull of pulls ) {

        dayIndex[ pull.created.slice( 0, 10 ) ].push( pull );

    }

    const approvalReport = fromJSON( Object.entries( dayIndex ).map( ( [ when, prs ] ) =>

        aggregates.reviewers.reduce(

            ( row, reviewer ) => ( { ...row, [ reviewer ]: prs.filter( pr => pr.approval && pr.approval.user === reviewer ).length } ),
            { when }

        )

    ) );

    console.log( approvalReport );

    fs.writeFileSync( path.resolve( __dirname, "approvals.csv" ), approvalReport );

}

main();