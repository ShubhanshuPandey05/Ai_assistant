function detectTurnEnd(currentText, options = {}) {
    // Configuration with defaults
    const config = {
        minLength: options.minLength || 2,
        silenceThreshold: options.silenceThreshold || 800, // ms
        punctuationWeight: options.punctuationWeight || 0.5,
        questionWeight: options.questionWeight || 0.7,
        statementWeight: options.statementWeight || 0.4,
        ...options
    };
    
    // Early return for very short or empty text
    if (!currentText || currentText.trim().length < config.minLength) {
        return false;
    }
    
    const text = currentText.trim();
    let score = 0;
    
    // 1. Definitive sentence endings (high confidence)
    const definitiveEndings = /[.!]\s*$/;
    if (definitiveEndings.test(text)) {
        score += 0.9;
    }
    
    // 2. Question completion patterns (very strong indicator)
    const questionPatterns = [
        /\?\s*$/,  // Direct question mark
        /^(what|how|why|when|where|who|which|can|could|would|should|do|does|did|is|are|was|were)\b.*[?.]?\s*$/i,
        /\b(right|okay|ok)\?\s*$/i,
        /\b(you know|understand|make sense)\?\s*$/i
    ];
    
    if (questionPatterns.some(pattern => pattern.test(text))) {
        score += config.questionWeight;
    }
    
    // 3. Natural completion phrases (strong indicators)
    const completionPhrases = [
        /\b(that's it|that's all|done|finished|complete)\b/i,
        /\b(thank you|thanks|bye|goodbye|see you)\b/i,
        /\b(anyway|anyhow|well|so|ok|okay|alright)\s*[.!]?\s*$/i,
        /\b(never mind|forget it|doesn't matter)\b/i
    ];
    
    if (completionPhrases.some(pattern => pattern.test(text))) {
        score += 0.8;
    }
    
    // 4. Response completion patterns
    const responsePatterns = [
        /\b(yes|no|sure|okay|alright|exactly|correct|right)\s*[.!]?\s*$/i,
        /\b(I think|I believe|I guess|I suppose)\b.*[.!]\s*$/i,
        /\b(maybe|probably|perhaps|possibly)\s*[.!]?\s*$/i
    ];
    
    if (responsePatterns.some(pattern => pattern.test(text))) {
        score += 0.6;
    }
    
    // 5. Incomplete patterns (reduce score - indicates ongoing speech)
    const incompletePatterns = [
        /\b(and|but|or|so|because|since|although|while|if|when|where|that|which)\s*$/i,
        /,\s*$/,  // Ends with comma
        /\b(the|a|an)\s*$/i,  // Ends with articles
        /\b(in|on|at|by|for|with|to|from)\s*$/i,  // Ends with prepositions
        /\b(I'm|I am|I was|I will|I have|I had)\s*$/i,  // Incomplete statements
        /\b(going to|want to|need to|have to)\s*$/i,  // Incomplete actions
        /\b(kind of|sort of|type of)\s*$/i  // Incomplete descriptions
    ];
    
    if (incompletePatterns.some(pattern => pattern.test(text))) {
        score -= 0.7;  // Strong penalty for incomplete patterns
    }
    
    // 6. Pause indicators and fillers (weak indicators)
    const pauseFillers = [
        /\b(um|uh|hmm|er|ah|eh)\s*$/i,
        /\.{2,}\s*$/,  // Multiple dots
        /\s{2,}$/  // Multiple spaces (can indicate pause)
    ];
    
    if (pauseFillers.some(pattern => pattern.test(text))) {
        score += 0.3;  // Moderate indicator
    }
    
    // 7. Command/request completion
    const commandPatterns = [
        /^(please|can you|could you|would you)\b.*[.!]?\s*$/i,
        /\b(help me|show me|tell me|give me|send me)\b.*[.!]?\s*$/i,
        /\b(find|search|look for|check)\b.*[.!]?\s*$/i
    ];
    
    if (commandPatterns.some(pattern => pattern.test(text))) {
        score += 0.5;
    }
    
    // 8. Length-based scoring (current text analysis)
    const wordCount = text.split(/\s+/).filter(word => word.length > 0).length;
    if (wordCount >= 3 && wordCount <= 15) {
        score += 0.2;  // Good length for complete thoughts
    }
    if (wordCount > 20) {
        score += 0.1;  // Longer text might be complete
    }
    
    // 9. Emotional expressions (often end turns)
    const emotionalEndings = [
        /\b(wow|great|amazing|awesome|terrible|awful|sad|happy|excited|surprised)\s*[!.]\s*$/i,
        /[!]{2,}\s*$/,  // Multiple exclamation marks
        /\b(oh no|oh wow|oh my|oh god|oh dear)\b/i
    ];
    
    if (emotionalEndings.some(pattern => pattern.test(text))) {
        score += 0.4;
    }
    
    // 10. Conversational turn-taking cues
    const turnTakingCues = [
        /\b(you know|I mean|like I said|basically|actually|honestly|seriously)\b.*[.!]\s*$/i,
        /\b(right|correct|exactly|precisely|absolutely)\s*[.!]?\s*$/i,
        /\b(your turn|go ahead|over to you)\b/i
    ];
    
    if (turnTakingCues.some(pattern => pattern.test(text))) {
        score += 0.5;
    }
    
    // Threshold-based decision (adjusted for real-time processing)
    const threshold = 0.5;  // Lower threshold for real-time detection
    return score >= threshold;
}

// Enhanced version with timing and streaming support
function detectTurnEndWithTiming(currentText, timingInfo = {}, options = {}) {
    const basicResult = detectTurnEnd(currentText, options);
    
    // If timing information is available, use it
    if (timingInfo.silenceDuration) {
        const silenceThreshold = options.silenceThreshold || 800;
        if (timingInfo.silenceDuration >= silenceThreshold) {
            return true;
        }
    }
    
    // If we have speech rate info
    if (timingInfo.speechRate) {
        // Very slow speech might indicate thinking/end of turn
        if (timingInfo.speechRate < 100) {
            return basicResult;
        }
        // Very fast speech might be incomplete
        if (timingInfo.speechRate > 200) {
            return basicResult && currentText.trim().length > 15;
        }
    }
    
    // If we have audio energy/volume info
    if (timingInfo.audioEnergy && timingInfo.audioEnergy < 0.1) {
        return basicResult; // Low energy might indicate end
    }
    
    return basicResult;
}

// Streaming version for real-time processing
function detectTurnEndStreaming(currentText, previousText = "", options = {}) {
    const currentResult = detectTurnEnd(currentText, options);
    
    // If text hasn't changed much, might be end of turn
    if (previousText && currentText.length - previousText.length < 2) {
        return currentResult;
    }
    
    // If text is growing rapidly, probably still speaking
    if (previousText && currentText.length - previousText.length > 10) {
        return false;
    }
    
    return currentResult;
}

// Utility function for batch processing
function batchTurnDetection(textArray, options = {}) {
    return textArray.map(text => ({
        text: text,
        turnEnd: detectTurnEnd(text, options)
    }));
}