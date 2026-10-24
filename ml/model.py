"""Small CNN-BiLSTM baseline for windowed Wi-Fi CSI amplitude features.

This model is trained and inferred on the PC. It is not an on-device medical model.
Input shape: [batch, time=64, features=64].
"""
import torch
from torch import nn


class CNNBiLSTM(nn.Module):
    def __init__(self, num_classes: int, feature_count: int = 64):
        super().__init__()
        self.feature_count = feature_count
        self.encoder = nn.Sequential(
            nn.Conv1d(feature_count, 64, kernel_size=5, padding=2, bias=False),
            nn.BatchNorm1d(64),
            nn.GELU(),
            nn.Dropout(0.10),
            nn.Conv1d(64, 96, kernel_size=5, padding=2, bias=False),
            nn.BatchNorm1d(96),
            nn.GELU(),
            nn.Dropout(0.10),
        )
        self.temporal = nn.LSTM(
            input_size=96,
            hidden_size=64,
            num_layers=1,
            batch_first=True,
            bidirectional=True,
        )
        self.attention = nn.Sequential(nn.Linear(128, 32), nn.Tanh(), nn.Linear(32, 1))
        self.head = nn.Sequential(
            nn.Linear(128, 64),
            nn.GELU(),
            nn.Dropout(0.25),
            nn.Linear(64, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # [B,T,F] -> [B,F,T] for temporal convolution
        x = x.transpose(1, 2)
        x = self.encoder(x)
        x = x.transpose(1, 2)
        x, _ = self.temporal(x)
        weights = torch.softmax(self.attention(x).squeeze(-1), dim=1).unsqueeze(-1)
        pooled = torch.sum(x * weights, dim=1)
        return self.head(pooled)
