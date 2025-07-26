import os
import math
import torch
import numpy as np
from typing import List, Dict, Tuple, Any

from transformers import AutoTokenizer
from optimum.onnxruntime import ORTModelForCausalLM
from optimum.exporters.onnx import main_export
from onnxruntime import InferenceSession, SessionOptions, GraphOptimizationLevel
import onnxruntime as ort

class ConversationTurnDetector:
    HF_MODEL_ID = "HuggingFaceTB/SmolLM2-135M-Instruct"
    ONNX_MODEL_DIR = "./onnx_model_3"
    MAX_HISTORY = 2
    DEFAULT_THRESHOLD = 0.03

    def __init__(self, threshold: float = DEFAULT_THRESHOLD):
        self.threshold = threshold
        self._prepare_environment()

        # Export ONNX model if not present
        if not os.path.exists(self.ONNX_MODEL_DIR):
            print("🔄 Exporting model to ONNX format...")
            main_export(
                model_name_or_path=self.HF_MODEL_ID,
                output=self.ONNX_MODEL_DIR,
                task="text-generation",
                use_cache=True
            )
            print("✅ Model exported to ONNX.")

        # Load tokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(self.HF_MODEL_ID, use_fast=True)

        # Load ONNX model with optimized session options
        self.model = ORTModelForCausalLM.from_pretrained(
            self.ONNX_MODEL_DIR,
            session_options=self._get_optimized_session_options(),
            file_name="model_int8.onnx"
        )
        self.model.generation_config.use_cache = False  # Prevent ONNX cache bugs

        self._warmup()

    def _prepare_environment(self):
        # Optional: for server threading boost
        os.environ["OMP_NUM_THREADS"] = "4"
        os.environ["MKL_NUM_THREADS"] = "4"

    def _get_optimized_session_options(self):
        import onnxruntime as ort
        options = ort.SessionOptions()
        options.execution_mode = ort.ExecutionMode.ORT_PARALLEL
        options.intra_op_num_threads = 4  # Tune this based on your CPU cores
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        return options

    def _warmup(self):
        prompt = "Hello!"
        inputs = self.tokenizer(prompt, return_tensors="pt", add_special_tokens=False)
        with torch.no_grad():
            _ = self.model(**inputs, use_cache=False)

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
        return tokenized_convo[:last_eot_index] if last_eot_index != -1 else tokenized_convo

    def get_next_token_logprobs(self, prompt_text: str) -> Dict[str, float]:
        inputs = self.tokenizer(prompt_text, return_tensors="pt", add_special_tokens=False)
        with torch.no_grad():
            outputs = self.model(**inputs, use_cache=False)

        logits = outputs.logits[0, -1, :]
        log_probs = torch.nn.functional.log_softmax(logits, dim=-1)

        k = 5
        top_vals, top_indices = torch.topk(log_probs, k)

        return {
            self.tokenizer.decode([top_indices[i].item()]): top_vals[i].item()
            for i in range(k)
        }

    def process_result(self, top_logprobs: Dict[str, float], target_tokens: List[str] = ["<|im_end|>"]) -> Tuple[float, str]:
        max_prob, best_token = 0.0, ""

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
