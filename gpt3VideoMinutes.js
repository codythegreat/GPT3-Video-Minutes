(function () {
    var containsTranscripts = false;
    var transcripts = []
    var transcriptMinuteIncrements = {};
    var answers = {};
    //var definitions = {};
    var isQuerying = false;
    var minuteSummaryInterval = null; // contains the setInterval ID so that we can nuke it when user closes div
    var videoURL = null;

    const FIRST_PROMPT_ENDING = '\nGiven the above information, please generate a summary of the current section below:'
    const SUBSEQUENT_PROMPT_ENDING = '\nGiven the above information, please continue generating summaries without repeating information:'

    async function getYoutubeTranscripts() {
        // click the button that shows the transcripts
        let moreActionsButton = [...document.getElementsByClassName("yt-spec-button-shape-next yt-spec-button-shape-next--tonal yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--icon-button ")]
            .filter(el => el.getAttribute('aria-label')==='More actions')[0] ?? false;

        if (moreActionsButton) {
            moreActionsButton.click();

            // wait for 500ms before clicking the transcriptions button
            await new Promise(resolve => setTimeout(resolve, 500));

            let transcriptionsButton = [...document.getElementsByClassName('style-scope ytd-menu-popup-renderer')].filter(el=>el.innerText==='Show transcript')[0] ?? false;

            if (transcriptionsButton) {
                containsTranscripts = true;

                transcriptionsButton.click();

                await new Promise(resolve => setTimeout(resolve, 500));

                transcripts = [...document.getElementsByTagName('ytd-transcript-segment-renderer')].map(el => el.innerText);

                await new Promise(resolve => setTimeout(resolve, 500));
                // click the button that closes the transcript
                [...document.getElementsByClassName('yt-spec-button-shape-next yt-spec-button-shape-next--text yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--icon-only-default ')]
                    .filter(el => el.getAttribute('aria-label') === "Close transcript")[0].click();
            }
        }
    }

    function getTranscriptMinuteIncrements() {
        let currentMinute = 0;

        transcripts.forEach(transcript => {
            let time = transcript.split('\n')[0].split(':').map(t => Number(t));
            let minute = time.length > 2
                ? time[1] + (60 * time[0])
                : time[0]; 

            while (currentMinute < minute) {
                currentMinute++;
            }

            // Add the transcript string to the current one-minute increment
            transcriptMinuteIncrements[currentMinute] = transcriptMinuteIncrements[currentMinute]
                ? transcriptMinuteIncrements[currentMinute] + transcript + '\n'
                : transcript + '\n';
        });
    }

    function createDiv() {
        // create the div element
        var div = document.createElement('div');
        div.id = 'cwm-openai-yt-query';

        // create the header element
        var header = document.createElement('header');
        header.innerHTML = 'OpenAI Video Minutes';

        // create the "X" button - closes the div
        var button = document.createElement('button');
        button.innerHTML = 'X';
        button.addEventListener('click', function() {
            resetVariables();
            destroyDivAndClearInterval();
        });

        // create the p element
        var p = document.createElement('p');

        // Create the search input element
        let searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Type a question here';

        // Create the p element to display the search results
        let searchResult = document.createElement('p');
        searchResult.id = 'cwm-openai-yt-answer';

        // Add an event listener to initiate the search when the user presses enter in the input
        searchInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            initiateSearch(searchInput.value).then(() => {
                showMinimizeButton();
            });
            searchInput.value = '';
        }
        });

        let minimizeButton = document.createElement('button');
        minimizeButton.id = 'cwm-openai-yt-answer-btn';
        minimizeButton.innerText = '^';
        minimizeButton.addEventListener('click', () => {
            searchResult.innerText = '';
            hideMinimizeButton();
        });

        // add the button and p elements to the header
        header.appendChild(button);

        // add the header and p elements to the div
        div.appendChild(header);
        div.appendChild(p);

        div.appendChild(searchInput);
        div.appendChild(searchResult);
        div.appendChild(minimizeButton);

        // add the div to the body of the page
        document.body.appendChild(div);
        createHeaderDivDragEventListener(div, header);
    }

    function createHeaderDivDragEventListener(outerDiv, headerDiv) {
        headerDiv.addEventListener('mousedown', function(event) {
            var isDragging = true;
            var currentX;
            var currentY;
            var initialX;
            var initialY;
            var xOffset = 0;
            var yOffset = 0;
            var scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
            var scrollBarHeight = window.innerHeight - document.documentElement.clientHeight;

            // prevent text selection while dragging
            document.onselectstart = function() { return false; };

            // get the initial position of the mouse
            initialX = event.clientX;
            initialY = event.clientY;

            // get the initial position of the outer div
            currentX = outerDiv.offsetLeft;
            currentY = outerDiv.offsetTop;

            // add a mousemove event listener to the document
            document.addEventListener('mousemove', function(event) {
                if (isDragging) {
                    // calculate the new position of the outer div
                    xOffset = event.clientX - initialX;
                    yOffset = event.clientY - initialY;
                    currentX = currentX + xOffset;
                    currentY = currentY + yOffset;

                    // update the position of the outer div
                    outerDiv.style.top =  Math.max(Math.min(currentY, window.innerHeight - outerDiv.offsetHeight - scrollBarHeight), 0) + 'px';
                    outerDiv.style.left = Math.max(Math.min(currentX, window.innerWidth - outerDiv.offsetWidth - scrollBarWidth), 0) + 'px';

                    // reset the initial position of the mouse
                    initialX = event.clientX;
                    initialY = event.clientY;
                }
            });

            // add a mouseup event listener to the document
            document.addEventListener('mouseup', function() {
                isDragging = false;
                // re-enable text selection
                document.onselectstart = function() { return true; };
            });
        });
    }

    async function queryOpenAI(body) {
        const OPENAI_DEFAULTS = {
            model: "text-davinci-003",
            prompt: "",
            temperature: 0.7,
            max_tokens: 256,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
        }

        body = {...OPENAI_DEFAULTS, ...body}
        console.log(body.prompt);

        let answer;

        await fetch('https://api.openai.com/v1/completions', {
            method: 'POST',
            headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify(body)
        })
            .then(response => response.json())
            .then(data => {
                if (data.choices) {
                    answer = data.choices[0].text.trim();
                }
            })
            .catch(error => console.error(error));

        return answer;
    }

    async function intervalFunction() {
        let div = document.getElementById("cwm-openai-yt-query")

        if (div) {
            let minute = getCurrentMinute();

            if (!answers[minute]) {
                isQuerying = true;
            
                let videoTitle = getVideoTitle();

                // if we are past minute 0 we can include previous summaries for context
                // include up to two summaries
                let previousSummaries = ''
                for (let i = Math.max(0, minute-2); i < minute; i++) {
                    previousSummaries += `Summary (${i}:00 - ${i}:59)\n${answers[i]}\n\n`;
                }

                // generate the current minute's summary
                answers[minute] = await queryOpenAI({ prompt: videoTitle + previousSummaries + transcriptMinuteIncrements[minute] + (minute > 0 ? FIRST_PROMPT_ENDING : SUBSEQUENT_PROMPT_ENDING) });  

                isQuerying = false;
            }

            // don't update unless we have a difference in text
            if (div.children[1].innerHTML !== answers[minute]) {
                div.children[1].innerHTML = answers[minute];
            }
        }
    }

    function destroyDivAndClearInterval() {
        let div = document.getElementById("cwm-openai-yt-query")
        div.parentNode.removeChild(div);
        clearInterval(minuteSummaryInterval);
    }

    function resetVariables() {
        containsTranscripts = false;
        transcripts = [];
        transcriptMinuteIncrements = {};
        answers = {};
        definitions = {};
        isQuerying = false;
        minuteSummaryInterval = null;
        videoURL = null;
    };

    async function initiateSearch(search) {
        let minute = getCurrentMinute();
        let videoTitle = getVideoTitle();

        let before = '\ngiven the above title and transcription, ';
        let prompt = videoTitle + transcriptMinuteIncrements[minute] + before + search;

        await queryOpenAI({ prompt: prompt }).then(answer => {
            document.getElementById('cwm-openai-yt-answer').innerText = answer;
        });
    }

    function getVideoTitle() {
        // some videos have hashtags first, then titles. Others just have titles
        // check with regex to always ensure we are grabbing the video's title!
        return 'Title:\n' + document.getElementById('above-the-fold').getElementsByTagName('span')[0].textContent.match(/^\#\w+.*\#\w+$/)
            ? document.getElementById('above-the-fold').getElementsByTagName('span')[1].textContent + '\n\n'
            : document.getElementById('above-the-fold').getElementsByTagName('span')[0].textContent + '\n\n';
    }

    function getCurrentMinute() {
        let player = document.getElementById('movie_player').wrappedJSObject;
        // since getCurrentTime gives us seconds, simply divide by 60
        return Math.floor(player.getCurrentTime() / 60);
    }

    function showMinimizeButton() {
        document.getElementById('cwm-openai-yt-answer-btn').style.display = 'block';
    }

    function hideMinimizeButton() {
        document.getElementById('cwm-openai-yt-answer-btn').style.display = 'none';

    }

    document.addEventListener('keydown', function(event) {
        if (event.ctrlKey && event.altKey && event.key === 't') {
            videoURL = window.location.href;
            getYoutubeTranscripts()
                .then(function() {
                    if (!containsTranscripts) {
                        return;
                    }
                    getTranscriptMinuteIncrements()
                    createDiv();
                    minuteSummaryInterval = setInterval(function(){
                        // if user has navigated away from the video, kill the div and variables
                        if (window.location.href !== videoURL) {
                            resetVariables();
                            destroyDivAndClearInterval();
                            return;
                        }
                        if (!isQuerying) {
                            intervalFunction();
                        }
                    }, 1000);
                });
        }
    });
})();