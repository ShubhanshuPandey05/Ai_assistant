import os
import math
import torch
from typing import List, Dict, Tuple, Any

from transformers import AutoTokenizer
from optimum.onnxruntime import ORTModelForCausalLM
from optimum.exporters.onnx import main_export


class ConversationTurnDetector:
    HF_MODEL_ID = "HuggingFaceTB/SmolLM2-360M-Instruct"
    ONNX_MODEL_DIR = "./onnx_model"
    MAX_HISTORY = 2
    DEFAULT_THRESHOLD = 0.03

    def __init__(self, threshold: float = DEFAULT_THRESHOLD):
        self.threshold = threshold

        # Export ONNX model if not already present
        if not os.path.exists(self.ONNX_MODEL_DIR):
            print("🔄 Exporting model to ONNX format...")
            main_export(
                model_name_or_path=self.HF_MODEL_ID,
                output=self.ONNX_MODEL_DIR,
                task="text-generation",
                use_cache=False  # important: disable cache for ONNX unless explicitly supported
            )
            print("✅ Model exported to ONNX.")

        # Load tokenizer and ONNX model
        self.tokenizer = AutoTokenizer.from_pretrained(self.HF_MODEL_ID, use_fast=True)
        self.model = ORTModelForCausalLM.from_pretrained(self.ONNX_MODEL_DIR)

        # Disable use_cache to prevent ONNX runtime errors
        self.model.generation_config.use_cache = False

        self._warmup()

    def _warmup(self):
        dummy = self.tokenizer("Hello", return_tensors="pt")
        with torch.no_grad():
            # ✅ Explicitly disable use_cache to avoid ONNX errors
            _ = self.model(**dummy, use_cache=False)

    def _convert_messages_to_chatml(self, messages: List[Dict[str, Any]]) -> str:
        if not messages:
            return ""

        tokenized_convo = self.tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=False,
            add_special_tokens=False,
            tokenize=False,
        )

        eot_token = "<|im_end|>"
        last_eot_index = tokenized_convo.rfind(eot_token)
        if last_eot_index != -1:
            return tokenized_convo[:last_eot_index]
        return tokenized_convo

    def get_next_token_logprobs(self, prompt_text: str) -> Dict[str, float]:
        inputs = self.tokenizer(prompt_text, return_tensors="pt", add_special_tokens=False)

        with torch.no_grad():
            outputs = self.model(**inputs, use_cache=False)

        logits = outputs.logits[0, -1, :]
        log_probs = torch.nn.functional.log_softmax(logits, dim=-1)

        k = 5
        top_vals, top_indices = torch.topk(log_probs, k)

        top_logprobs = {}
        for i in range(k):
            token_id = top_indices[i].item()
            token_str = self.tokenizer.decode([token_id])
            logprob_val = top_vals[i].item()
            top_logprobs[token_str] = logprob_val

        return top_logprobs

    def process_result(self, top_logprobs: Dict[str, float], target_tokens: List[str] = ["<|im_end|>"]) -> Tuple[float, str]:
        max_prob = 0.0
        best_token = ""

        for token_str, logprob in top_logprobs.items():
            stripped_token = token_str.strip()
            if stripped_token in target_tokens:
                prob = math.exp(logprob)
                if prob > max_prob:
                    max_prob = prob
                    best_token = stripped_token

        return max_prob, best_token

    def predict_eot_prob(self, messages: List[Dict[str, Any]]) -> float:
        truncated_messages = messages[-self.MAX_HISTORY:]
        text_input = self._convert_messages_to_chatml(truncated_messages)
        top_logprobs = self.get_next_token_logprobs(text_input)
        eot_prob, _ = self.process_result(top_logprobs)

        print(f"EOT Probability: {eot_prob:.4f}")
        return eot_prob

    def detect_turn_completion(self, messages: List[Dict[str, Any]]) -> bool:
        eot_prob = self.predict_eot_prob(messages)
        return eot_prob > self.threshold


# 🧪 Test Example
if __name__ == "__main__":
    detector = ConversationTurnDetector()
    messages = [
        {"role": "user", "content": "What's the weather like today?"},
        {"role": "assistant", "content": "It's sunny and 25 degrees Celsius."}
    ]
    is_done = detector.detect_turn_completion(messages)
    print("Is turn completed?", is_done)
