const PORT = process.env.PORT || 8080;

const express = require('express');
const app = express();

const axios = require('axios');
axios.defaults.timeout = 30000;

const cheerio = require('cheerio');

const bodyParser = require('body-parser');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const { Pool } = require('pg');
const { url } = require('inspector');
//lol
//DEVELOPEMENT Database connection information.
const DEVpool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'postgres',
    password: 'super',
    port: 5432,
  })

//PRODUCTION Database connection information.
const PRODpool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

//set this to either DEVpool during production or PRODpool when deploying to production.
const pool = PRODpool; 

//global variables to help monitor the webscrapping.
var errors = [];
var ASStatus = false;
var MBFCStatus = false;

//start the app.
app.listen(PORT, () => console.log(`server running on PORT ${PORT}`))

/////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////
//allsides.com webscrapping script.

var allsidesProfiles = []
var allsidesDatabase = []

//main function to call to intiate allsides.com webscrapping.
function updateASDatabase(){
    ASStatus = true;
    allsidessearchpages = []
    for(let i = 0; i < 40; i++){
        const url2 = `https://www.allsides.com/media-bias/ratings?page=${i}&field_featured_bias_rating_value=All&field_news_source_type_tid%5B0%5D=1&field_news_source_type_tid%5B1%5D=2&field_news_source_type_tid%5B2%5D=3&field_news_source_type_tid%5B3%5D=4&field_news_source_type_tid%5B4%5D=5&field_news_bias_nid_1%5B1%5D=1&field_news_bias_nid_1%5B2%5D=2&field_news_bias_nid_1%5B3%5D=3&title=`;
        allsidessearchpages.push(url2)
    }
    gatherASProfiles(allsidessearchpages)
}

//This function will go through all search pages on allsides.com for profiles with ratings and extract the listed profiles.
function gatherASProfiles(array){
    const url =  array.shift();
    if(url){
        axios.get(url)
        .then(response => {
            console.log(url);
            console.log(response.status)
            const html = response.data;
            const $ = cheerio.load(html);
            $("tr").each((i,element) => {
                const name = $(element).find("td.source-title").find("a").text();
                if(name !== ""){
                    const allsidesurl = $(element).find("td.source-title").find("a").attr("href");
                    var bias = $(element).find("td.views-field-field-bias-image").find("a").attr("href");
                    const agreement = $(element).find("div").find("span.agree").html();
                    const disagreement = $(element).find("div").find("span.disagree").html();
                    if(bias === undefined){
                        bias = "no bias available";
                    }
                    allsidesProfiles.push({
                        name: name,
                        allsidesurl:  "https://www.allsides.com" + allsidesurl,
                        bias: bias.replace("/media-bias/",""),
                        agreement: agreement,
                        disagreement: disagreement,
                    });
                }
            });    

            if($("td:contains(No Record(s) found.)").text()){
                console.log("end of search found")
                var half = Math.ceil(allsidesProfiles.length/2)
                crawlAS(allsidesProfiles.slice(0,half))
                crawlAS(allsidesProfiles.slice(-half))
            }
            else{
                gatherASProfiles(array)
            }
        })
        .catch(err => {
            console.log(err.message);
            errors.push(err.message);
        });
    }
}

//This function will go through all the gathered profiles and collect more information on each profile page.
function crawlAS(profilesarray){
    if (profilesarray.length == 0){
        saveArrayToAllsidesDatabase(allsidesDatabase)
        console.log("saved to database")
        return 0;
    }
    
    var profile = profilesarray.shift()
    console.log("obtaining data from " + profile.allsidesurl + " " + profilesarray.length + " profiles left to crawl through.");
    axios.get(profile.allsidesurl)
        .then(response => {
            const html = response.data;
            const $ = cheerio.load(html);

            const type = $("div").find("div.latest_news_source").find("p").text();
            
            var url = $("div").find("div.dynamic-grid").find("a").attr("href");
            if(url === undefined){
                url = "no url available";
            }
            else{
                let arr = url.split("/");   
                url = arr[2];
            }
            
            var confidence = $("div").find("ul.b-list").text().split("\n");
            var confidence = confidence[10];
            if (confidence.includes("low")){
                confidence = "low/inital rating";
            }
            else if (confidence.includes("medium")){
                confidence = "medium";
            }
            else if (confidence.includes("high")){
                confidence = "high";
            }
            else{
                confidence = "no confidence level available";
            }

            profile.type = type;
            profile.url = url;  
            profile.confidence = confidence;
            
            allsidesDatabase.push(profile)
            crawlAS(profilesarray)
            
        })
        .catch(err => {
            console.log(err.message)
            errors.push(err.message);
            crawlAS(profilesarray)
        })

}

//saves allsides data to allsides database (postgres).
function saveArrayToAllsidesDatabase(array){
    pool.query(`DELETE FROM allsides`, (err, result)=>{
        if(err){
            console.log(err.message)
            errors.push(err.message);
        }
    });
    for (var i = 0; i < array.length; i++) {
        let data = array[i];
        nameSQL = data.name.replace("'","''");
        let insertQuery = `insert into allsides(name, allsidesurl, type, url, bias, agreement, disagreement, confidence) 
                            values('${nameSQL}', '${data.allsidesurl}', '${data.type}', '${data.url}', '${data.bias}', '${data.agreement}', '${data.disagreement}', '${data.confidence}')` 
        pool.query(insertQuery, (err, result)=>{
            if(err){
                console.log(err.message);
                errors.push(err.message);
            }
        })
    }
    ASStatus = false;
}

/////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////
//mediabiasfactcheck.com webscrapping script.

var MBFCProfiles = [];
var MBFCDatabase = [];

//Main function to call to intiate mediabiasfactcheck.com webscrapping.
function updateMBFCDatabase(){
    MBFCStatus = true;
    const MBFCCategories = [
        "https://mediabiasfactcheck.com/left/",
        "https://mediabiasfactcheck.com/leftcenter/",
        "https://mediabiasfactcheck.com/center/",
        "https://mediabiasfactcheck.com/right-center/",
        "https://mediabiasfactcheck.com/right/",
        "https://mediabiasfactcheck.com/conspiracy/",
        "https://mediabiasfactcheck.com/fake-news/",
        "https://mediabiasfactcheck.com/pro-science/",
        "https://mediabiasfactcheck.com/satire/"
    ]
    gatherMBFCProfiles(MBFCCategories)
}

//This function will go through all the category pages on mediabiasfactcheck.com and extract the listed profiles.
function gatherMBFCProfiles(categories) {
    var category = categories.shift()
    console.log("obtaining profiles from " + category);
    axios.get(category)
    .then(response => {
        const html = response.data;
        const $ = cheerio.load(html);
        $("td").each((j, element) => {
            if($(element).find("a").attr("href") !== ("" || undefined)){
                var profile = {}
                profile.url = $(element).find("a").attr("href");
                profile.category = category.split("/")[3]
                MBFCProfiles.push(profile)
            }
        });        
        if (categories.length > 0){
            gatherMBFCProfiles(categories)
        }
        else {
            console.log("done gathering profiles")
            var half = Math.ceil(MBFCProfiles.length/2)
            crawlMBFC(MBFCProfiles.slice(0,half))
            crawlMBFC(MBFCProfiles.slice(-half))

        }
    })
    .catch(err => {
        console.log(err.message)
        errors.push(err.message);
    })
}


//This function will go through all the gathered profiles and collect information on each profile page.
function crawlMBFC(profiles){
    if (profiles.length == 0){
        return 0;
    }
    var profile = profiles.shift()
    console.log("obtaining data from " + profile.url + " " + profiles.length + " profiles left to crawl through.");
    axios.get(profile.url)
        .then(response => {
            const html = response.data;
            const $ = cheerio.load(html);
            var data = {}
            data.name = $("h1.entry-title").text().replaceAll("\n","").replaceAll("\t","")
            data.MBFCurl = profile.url
            
            if ( $('p:contains("Source:")').find("a").attr("href") !== undefined) {
                data.url = $('p:contains("Source:")').find("a").attr("href")
            }
            else {
                data.url = "no url available"
            }
            
            data.bias = profile.category
            if (data.bias == "leftcenter"){
                data.bias = "left-center"
            }
            
            if ($("img.size-full[data-image-title^=MBFC]").attr("data-image-title") !== undefined) {
                data.factual = $("img.size-full[data-image-title^=MBFC]").attr("data-image-title").replace("MBFC","")
            }
            else if ($("img.size-full[data-image-title^=mbfc_]").attr("data-image-title") !== undefined) {
                data.factual = $("img.size-full[data-image-title^=mbfc_]").attr("data-image-title").replace("mbfc_","")
            }
            else {
                data.factual = "no factual reporting rating"
            }

            data.factual = fixFactual(data.factual);

            if ($('strong:contains("CREDIBILITY")').text() !== (undefined || "")) {
                data.credibility = $('strong:contains("CREDIBILITY")').text().toLowerCase()
            }
            else {
                data.credibility = "no credibility rating available"
            }
            //console.log(data)
            if (data.name !== ""){
                MBFCDatabase.push(data)
            }
            

            if (profiles.length > 0){
                crawlMBFC(profiles)
            }
            else {
                //save(MBFCDatabase)
                saveArrayToMBFCDatabase(MBFCDatabase)
                console.log("saved to database")
            }
        })
        .catch(err => {
            console.log(err.message)
            errors.push(err.message);
            crawlMBFC(profiles)
        })

}

//Fixes factual data in profile data from mediabiasfactcheck.com.
function fixFactual(a){
    if(a == "Veryhigh"){
        return "very high"
    }
    else if(a == "High"){
        return "high"
    }
    else if(a == "Mostlyfactual"){
        return "mostly"
    }
    else if(a == "MostlyFactual"){
        return "mostly"
    }
    else if(a == "Mixed"){
        return "mixed"
    }
    else if(a == "Low"){
        return "low"
    }
    else if(a == "Verylow"){
        return "very low"
    }
    else if(a == "Verylow"){
        return "very low"
    }
    else {
        return a
    }
}

//saves mediabiasfactcheck.com data to mbfc database (postgres).
function saveArrayToMBFCDatabase(array){
    pool.query(`DELETE FROM mbfc`, (err, result)=>{
        if(err){
            console.log(err.message)
            errors.push(err.message);
        }
    });
    for (var i = 0; i < array.length; i++) {
        let data = array[i];
        nameSQL = data.name.replace("'","''");
        let insertQuery = `insert into mbfc (name, profile, url, bias, factual, credibility) 
                            values('${nameSQL}', '${data.MBFCurl}', '${data.url}', '${data.bias}', '${data.factual}', '${data.credibility}')` 
        pool.query(insertQuery, (err, result)=>{
            console.log("saving data to database")
            if(err){
                console.log(err.message);
                errors.push(err.message);
            }
        })
        
    }
    MBFCStatus = false;
}

/////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////

//API ENDPOINTS
/**
 * GET /
 * Summary: Returns introduction to API.
 */
app.get('/', (req, res) => {
    res.json({ message: 'Welcome to Politicatl Bias Database. The database contains allsides.com and mediabiasfactcheck.com data that I have webscrapped. This API wass developed by Alberto Andres Escobar Mingo.' });
})

/**
 * GET /createDatabases
 * Administrative endpoint, only used to get the databases created.
 */
 app.get('/createDatabases', (req, res) => {
    pool.query(`CREATE TABLE allsides (name text,url text,allsidesurl text,type text,bias text,agreement text,disagreement text,confidence text);`, (err, result)=>{
        if(!err){
            pool.query(`CREATE TABLE mbfc (name text, url text,profile text,  bias text, factual text, credibility text);`, (err, result)=>{
                if(!err){
                    res.json({ message: "successfully made tables" });
                }
                else{
                    console.log(err.message)
                    res.json({ message: "error in creating MBFC table" });
                }
            });
        }
        else{
            console.log(err.message)
            res.json({ message: "error in creating AS table" });
        }
    });
})

/**
 * GET /update
 * Summary: Triggers updating of the databases, the API will execute the webscrapping algorithm. 
 * This takes 30 minutes to complete due to the amount of requests made to both websites.
 * If this function is called during updating, a message indicating that the databases are undergoing updating will be returned.
 */
app.get('/update', (req, res) => {
    if(ASStatus || MBFCStatus){
        res.json({ message: "Databases are being updated." });
    }
    else{
        updateASDatabase();
        updateMBFCDatabase();
        res.json({ message: "updating database, please wait 30 minutes for database to fully update." });
    }
})

/**
 * GET /errors
 * Summary: Returns the errors array. Errors are recorded if any HTTP request fails.
 */
 app.get('/errors', (req, res) => {
    res.json(errors);
})

/**
 * GET /ASdata
 * Summary: Returns the allsides database in a JSON array.
 */
app.get('/ASdata', (req, res) => {
    pool.query(`Select name, allsidesurl, type, url, bias, agreement, disagreement, confidence from allsides`, (err, result)=>{
        if(!err){
            let output = result.rows
            for (var i = 0; i < output.length; i++) {
                output[i].name = output[i].name.replace("''","'");
            }
            res.json(output);
        }
        else{
            console.log(err.message)
            res.json({ message: "error in data" });
        }
    });
})

/**
 * GET /MBFCdata
 * Summary: Returns the MBFC database in a JSON array.
 */

app.get('/MBFCdata', (req, res) => {
    pool.query(`Select name, profile, url, bias, factual, credibility from mbfc`, (err, result)=>{
        if(!err){
            let output = result.rows
            for (var i = 0; i < output.length; i++) {
                output[i].name = output[i].name.replace("''","'");
            }
            res.json(output);
        }
        else{
            console.log(err.message)
            res.json({ message: "error in data" });
        }
    });
})

///API ENDPOINTS FOR EXTENSION
/**
 * GET /extension/ASdata
 * Summary: Returns the allsides database in a JSON array. This endpoint is for exclusive use by transparent media chrome extension.
 */
 app.get('/extension/ASdata', (req, res) => {
    pool.query(`Select name, allsidesurl, type, url, bias, agreement, disagreement, confidence from allsides`, (err, result)=>{
        if(!err){
            let output = result.rows
            for (var i = 0; i < output.length; i++) {
                output[i].name = output[i].name.replace("''","'");
            }
            res.json(output);
        }
        else{
            console.log(err.message)
            res.json({ message: "error in data" });
        }
    });
})

/**
 * GET /extension/MBFCdata
 * Summary: Returns the MBFC database in a JSON array. This endpoint is for exclusive use by transparent media chrome extension.
 */

app.get('/extension/MBFCdata', (req, res) => {
    pool.query(`Select name, profile, url, bias, factual, credibility from mbfc`, (err, result)=>{
        if(!err){
            let output = result.rows
            for (var i = 0; i < output.length; i++) {
                output[i].name = output[i].name.replace("''","'");
            }
            res.json(output);
        }
        else{
            console.log(err.message)
            res.json({ message: "error in data" });
        }
    });
})